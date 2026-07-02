import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  workers,
  departments,
  terminals,
  supervisorScopes,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { getPayrollCutoffTime } from "@/lib/settings";
import { computePayrollForWorkers, STATUS_MULTIPLIER } from "@/lib/payroll-report";
import { PayrollClient, type PayrollEntry } from "./payroll-client";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: { date?: string; terminal?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const closingDate = searchParams.date ?? new Date().toISOString().slice(0, 10);
  const cutoffTime = await getPayrollCutoffTime();

  // ── Scoped terminals ─────────────────────────────────────────────────────────
  const allTerminals = await db
    .select()
    .from(terminals)
    .orderBy(terminals.createdAt);

  let allowedTerminalIds: string[];
  let allowedDeptIds: string[];

  if (session.user.role === "admin") {
    allowedTerminalIds = allTerminals.map((t) => t.id);
    allowedDeptIds = (
      await db.select({ id: departments.id }).from(departments)
    ).map((d) => d.id);
  } else {
    const scopes = await db
      .select()
      .from(supervisorScopes)
      .where(eq(supervisorScopes.userId, session.user.id));

    allowedTerminalIds = Array.from(new Set(scopes.map((s) => s.terminalId)));

    const allDepts = await db.select().from(departments);
    const ids: string[] = [];
    for (const scope of scopes) {
      if (scope.departmentId) {
        ids.push(scope.departmentId);
      } else {
        // Terminal-wide scope (no department set) — every department under
        // this terminal is visible, not just one. See HANDOFF.md Step 18.
        allDepts
          .filter((d) => d.terminalId === scope.terminalId)
          .forEach((d) => ids.push(d.id));
      }
    }
    allowedDeptIds = Array.from(new Set(ids));
  }

  const visibleTerminals = allTerminals.filter((t) =>
    allowedTerminalIds.includes(t.id)
  );
  const activeTerminalId =
    searchParams.terminal ?? visibleTerminals[0]?.id ?? "";

  // ── Daily-pay workers for this terminal ───────────────────────────────────────
  const workerRows =
    activeTerminalId
      ? await db
          .select({
            id: workers.id,
            employeeCode: workers.employeeCode,
            fullName: workers.fullName,
            terminalId: workers.terminalId,
            departmentId: workers.departmentId,
            dailyRate: workers.dailyRate,
            deptName: departments.name,
          })
          .from(workers)
          .leftJoin(departments, eq(workers.departmentId, departments.id))
          .where(
            and(
              eq(workers.terminalId, activeTerminalId),
              eq(workers.status, "active"),
              eq(workers.payType, "daily"),
              inArray(workers.departmentId, allowedDeptIds)
            )
          )
          .orderBy(departments.name, workers.fullName)
      : [];

  const workerIds = workerRows.map((w) => w.id);

  const computedMap = await computePayrollForWorkers(workerIds, closingDate, cutoffTime);

  const entries: PayrollEntry[] = workerRows.map((w) => {
    const c = computedMap.get(w.id);
    const shiftsWorked = c?.shiftsWorked ?? 0;
    const checkoutMissing = c?.checkoutMissing ?? false;
    const status = c?.status ?? "absent";
    const dailyRate = w.dailyRate ?? 0;
    const amount = Math.round(dailyRate * STATUS_MULTIPLIER[status]);

    return {
      workerId: w.id,
      employeeCode: w.employeeCode,
      fullName: w.fullName,
      deptName: w.deptName ?? "—",
      terminalId: w.terminalId,
      departmentId: w.departmentId,
      dailyRate,
      shiftsWorked,
      checkoutMissing,
      status,
      amount,
    };
  });

  return (
    <PayrollClient
      closingDate={closingDate}
      cutoffTime={cutoffTime}
      terminalId={activeTerminalId}
      visibleTerminals={visibleTerminals.map((t) => ({ id: t.id, name: t.name }))}
      entries={entries}
    />
  );
}
