import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getPayrollCutoffTime } from "@/lib/settings";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/dashboard");

  const payrollCutoffTime = await getPayrollCutoffTime();

  return <SettingsClient payrollCutoffTime={payrollCutoffTime} />;
}
