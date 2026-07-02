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
