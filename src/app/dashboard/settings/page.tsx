import { auth } from "@/auth";
import { redirect } from "next/navigation";
import {
  getPayrollCutoffTime,
  getMaxOpenShiftHours,
  getKioskRefreshMinutes,
  getMinShiftMinutes,
  getMissingCheckoutHours,
} from "@/lib/settings";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/dashboard");

  const payrollCutoffTime = await getPayrollCutoffTime();
  const maxOpenShiftHours = await getMaxOpenShiftHours();
  const kioskRefreshMinutes = await getKioskRefreshMinutes();
  const minShiftMinutes = await getMinShiftMinutes();
  const missingCheckoutHours = await getMissingCheckoutHours();

  return (
    <SettingsClient
      payrollCutoffTime={payrollCutoffTime}
      maxOpenShiftHours={maxOpenShiftHours}
      kioskRefreshMinutes={kioskRefreshMinutes}
      minShiftMinutes={minShiftMinutes}
      missingCheckoutHours={missingCheckoutHours}
    />
  );
}
