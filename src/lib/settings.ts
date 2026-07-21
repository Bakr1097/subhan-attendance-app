import { db } from "@/lib/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

const DEFAULTS: Record<string, string> = {
  payrollCutoffTime: "14:30",
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

export async function recordBiometricHeartbeat(input: {
  ranAt: string;
  success: boolean;
  recordsSynced: number;
  message: string | null;
}): Promise<void> {
  const prev = await getBiometricSyncStatus();
  const status: BiometricSyncStatus = {
    ranAt: input.ranAt,
    success: input.success,
    recordsSynced: input.recordsSynced,
    message: input.message,
    lastSuccessAt: input.success ? input.ranAt : prev?.lastSuccessAt ?? null,
  };
  await setSetting(BIOMETRIC_SYNC_STATUS_KEY, JSON.stringify(status));
}
