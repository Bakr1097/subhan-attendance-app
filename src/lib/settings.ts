import { db } from "@/lib/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const DEFAULTS: Record<string, string> = {
  payrollCutoffTime: "14:30",
  maxOpenShiftHours: "14",
  kioskRefreshMinutes: "60",
  minShiftMinutes: "60",
  missingCheckoutHours: "11",
  longShiftReviewHours: "13",
};

export async function getSetting(key: string): Promise<string> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? DEFAULTS[key] ?? "";
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

export async function getPayrollCutoffTime(): Promise<string> {
  return getSetting("payrollCutoffTime");
}

export async function getMaxOpenShiftHours(): Promise<number> {
  const raw = await getSetting("maxOpenShiftHours");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

// Step 33: a punch this soon after an open check-in is ignored (0 = off).
export async function getMinShiftMinutes(): Promise<number> {
  const raw = await getSetting("minShiftMinutes");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 && n <= 240 ? n : 60;
}

// Step 33: an open check-in shows "missing checkout" after this many hours.
export async function getMissingCheckoutHours(): Promise<number> {
  const raw = await getSetting("missingCheckoutHours");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : 11;
}

// Step 34: a closed shift longer than this gets a "Check this shift" flag.
export async function getLongShiftReviewHours(): Promise<number> {
  const raw = await getSetting("longShiftReviewHours");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : 13;
}

export async function getKioskRefreshMinutes(): Promise<number> {
  const raw = await getSetting("kioskRefreshMinutes");
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 5 && n <= 240 ? n : 60;
}

// ─── Biometric bridge heartbeat ────────────────────────────────────────────
// A single JSON blob under one app_settings row — the bridge posts a
// heartbeat after every run (success or failure). `lastSuccessAt` is tracked
// separately from `ranAt` so a string of failed runs doesn't erase how long
// it's actually been since data last flowed, which is what the dashboard
// warning needs to detect a silently-dead bridge.
const BIOMETRIC_SYNC_STATUS_KEY = "biometricSyncStatus";

export interface BiometricSyncStatus {
  ranAt: string;
  success: boolean;
  recordsSynced: number;
  message: string | null;
  lastSuccessAt: string | null;
}

export async function getBiometricSyncStatus(): Promise<BiometricSyncStatus | null> {
  const raw = await getSetting(BIOMETRIC_SYNC_STATUS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BiometricSyncStatus;
  } catch {
    return null;
  }
}

// Step 28: the bridge pings this endpoint every run (every few minutes,
// around the clock) but most runs report nothing new — same `success` and
// the same static "No new punches since last sync." message. Writing on
// every one of those was pure wasted Neon compute for a value that hadn't
// changed. We now skip the write when the incoming heartbeat is identical
// in substance to what's stored, EXCEPT we still force a write at least
// once every KEEPALIVE_MS even with no change, so the Dashboard's "last
// seen" timestamp can't go stale indefinitely during a long quiet spell
// (e.g. overnight with no punches). Tradeoff: "last seen" is now accurate
// to within KEEPALIVE_MS, not to the minute — acceptable since the point
// of the health card is detecting a dead bridge, not a live clock.
const HEARTBEAT_KEEPALIVE_MS = 60 * 60 * 1000; // force a refresh write at most once/hour when nothing changed

export async function recordBiometricHeartbeat(input: {
  ranAt: string;
  success: boolean;
  recordsSynced: number;
  message: string | null;
}): Promise<void> {
  const prev = await getBiometricSyncStatus();

  const changed =
    prev === null ||
    prev.success !== input.success ||
    prev.message !== input.message ||
    prev.recordsSynced !== input.recordsSynced;
  const staleEnoughToRefresh =
    prev !== null && Date.now() - new Date(prev.ranAt).getTime() >= HEARTBEAT_KEEPALIVE_MS;

  if (!changed && !staleEnoughToRefresh) {
    return;
  }

  const status: BiometricSyncStatus = {
    ranAt: input.ranAt,
    success: input.success,
    recordsSynced: input.recordsSynced,
    message: input.message,
    lastSuccessAt: input.success ? input.ranAt : prev?.lastSuccessAt ?? null,
  };
  await setSetting(BIOMETRIC_SYNC_STATUS_KEY, JSON.stringify(status));
}

// ─── Unmatched biometric device IDs (Step 30) ──────────────────────────────
// Punches whose deviceUserId isn't mapped to any worker used to be returned
// in the punch response and printed only on the bridge PC. They're now kept
// in one app_settings JSON row (no migration) so an admin can see them on the
// Dashboard. Only written when a batch actually contains unmatched IDs.
const UNMATCHED_DEVICE_IDS_KEY = "biometricUnmatchedDeviceIds";

export interface UnmatchedDeviceId {
  deviceUserId: string;
  punchCount: number;
  firstPunchAt: string;
  lastPunchAt: string;
  lastSeenAt: string;
}

export async function getUnmatchedDeviceIds(): Promise<UnmatchedDeviceId[]> {
  const raw = await getSetting(UNMATCHED_DEVICE_IDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, UnmatchedDeviceId>;
    return Object.values(parsed).sort((a, b) => b.lastPunchAt.localeCompare(a.lastPunchAt));
  } catch {
    return [];
  }
}

export async function recordUnmatchedDeviceIds(
  punches: { deviceUserId: string; timestamp: Date }[]
): Promise<void> {
  const existing = await getUnmatchedDeviceIds();
  const byId: Record<string, UnmatchedDeviceId> = {};
  for (const e of existing) byId[e.deviceUserId] = e;

  const seenAt = new Date().toISOString();
  for (const { deviceUserId, timestamp } of punches) {
    const at = timestamp.toISOString();
    const e = byId[deviceUserId];
    if (!e) {
      byId[deviceUserId] = { deviceUserId, punchCount: 1, firstPunchAt: at, lastPunchAt: at, lastSeenAt: seenAt };
    } else {
      e.punchCount++;
      if (at < e.firstPunchAt) e.firstPunchAt = at;
      if (at > e.lastPunchAt) e.lastPunchAt = at;
      e.lastSeenAt = seenAt;
    }
  }
  await setSetting(UNMATCHED_DEVICE_IDS_KEY, JSON.stringify(byId));
}

