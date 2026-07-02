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
