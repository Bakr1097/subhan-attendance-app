"use server";

import { auth } from "@/auth";
import { setSetting } from "@/lib/settings";
import { revalidatePath } from "next/cache";

export async function updatePayrollCutoffTime(value: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Unauthorized");

  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    throw new Error("Cutoff time must be in HH:MM (24h) format");
  }

  await setSetting("payrollCutoffTime", value);

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard");
}

export async function updateMaxOpenShiftHours(value: number) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Unauthorized");

  if (!Number.isInteger(value) || value < 1 || value > 24) {
    throw new Error("Maximum open shift must be a whole number between 1 and 24");
  }

  await setSetting("maxOpenShiftHours", String(value));

  revalidatePath("/dashboard/settings");
}

export async function updateKioskRefreshMinutes(value: number) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Unauthorized");

  if (!Number.isInteger(value) || value < 5 || value > 240) {
    throw new Error("Kiosk refresh interval must be a whole number between 5 and 240");
  }

  await setSetting("kioskRefreshMinutes", String(value));

  revalidatePath("/dashboard/settings");
  revalidatePath("/kiosk");
}

// Step 33: a punch this soon after an open check-in is ignored. 0 turns it off.
export async function updateMinShiftMinutes(value: number) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Unauthorized");

  if (!Number.isInteger(value) || value < 0 || value > 240) {
    throw new Error("Minimum shift length must be a whole number between 0 and 240");
  }

  await setSetting("minShiftMinutes", String(value));

  revalidatePath("/dashboard/settings");
}

// Step 33: an open check-in shows "missing checkout" after this many hours.
export async function updateMissingCheckoutHours(value: number) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Unauthorized");

  if (!Number.isInteger(value) || value < 1 || value > 24) {
    throw new Error("Missing checkout warning must be a whole number between 1 and 24");
  }

  await setSetting("missingCheckoutHours", String(value));

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard");
}
