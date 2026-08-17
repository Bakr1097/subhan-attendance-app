import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getPayrollCutoffTime, getMaxOpenShiftHours, getKioskRefreshMinutes } from "@/lib/settings";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/dashboard");

  const payrollCutoffTime = await getPayrollCutoffTime();
  const maxOpenShiftHours = await getMaxOpenShiftHours();
  const kioskRefreshMinutes = await getKioskRefreshMinutes();

  return (
    <SettingsClient
      payrollCutoffTime={payrollCutoffTime}
      maxOpenShiftHours={maxOpenShiftHours}
      kioskRefreshMinutes={kioskRefreshMinutes}
    />
  );
}
