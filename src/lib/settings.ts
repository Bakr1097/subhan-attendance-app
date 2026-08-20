import { db } from "@/lib/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const DEFAULTS: Record<string, string> = {
  payrollCutoffTime: "14:30",
  maxOpenShiftHours: "14",
  kioskRefreshMinutes: "60",
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
