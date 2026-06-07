import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  workers,
  departments,
  terminals,
  attendanceRecords,
  supervisorScopes,
} from "@/db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { ReportsClient, type WorkerSummary } from "./reports-client";

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function daysElapsed(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  const today = new Date();
  const firstOfMonth = new Date(y, m - 1, 1);
  if (firstOfMonth > today) return 0;
  if (y === today.getFullYear() && m === today.getMonth() + 1) return today.getDate();
  return new Date(y, m, 0).getDate();
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { month?: string; terminal?: string; dept?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const month = searchParams.month ?? new Date().toISOString().slice(0, 7);
  const firstDay = `${month}-01`;
  const lastDay = lastDayOfMonth(month);

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
  const activeDeptId = searchParams.dept ?? "";

  // ── Department filter options ─────────────────────────────────────────────────
  const terminalDepts =
    activeTerminalId && allowedDeptIds.length > 0
      ? await db
          .select({ id: departments.id, name: departments.name })
          .from(departments)
          .where(
            and(
              eq(departments.terminalId, activeTerminalId),
              inArray(departments.id, allowedDeptIds)
            )
          )
          .orderBy(departments.name)
      : [];

  // ── Workers ───────────────────────────────────────────────────────────────────
  let workerRows: Array<{
    id: string;
    employeeCode: string;
    fullName: string;
    departmentId: string;
    deptName: string | null;
  }> = [];

  if (activeTerminalId && allowedDeptIds.length > 0) {
    const baseCondition = and(
      eq(workers.terminalId, activeTerminalId),
      eq(workers.status, "active"),
      inArray(workers.departmentId, allowedDeptIds)
    );
    const condition = activeDeptId
      ? and(baseCondition, eq(workers.departmentId, activeDeptId))
      : baseCondition;

    workerRows = await db
      .select({
        id: workers.id,
        employeeCode: workers.employeeCode,
        fullName: workers.fullName,
        departmentId: workers.departmentId,
        deptName: departments.name,
      })
      .from(workers)
      .leftJoin(departments, eq(workers.departmentId, departments.id))
      .where(condition)
      .orderBy(departments.name, workers.fullName);
  }

  const workerIds = workerRows.map((w) => w.id);

  // ── Attendance records for the month ─────────────────────────────────────────
  const records =
    workerIds.length > 0
      ? await db
          .select({
            workerId: attendanceRecords.workerId,
            status: attendanceRecords.status,
            workedMinutes: attendanceRecords.workedMinutes,
            isLate: attendanceRecords.isLate,
          })
          .from(attendanceRecords)
          .where(
            and(
              inArray(attendanceRecords.workerId, workerIds),
              gte(attendanceRecords.workDate, firstDay),
              lte(attendanceRecords.workDate, lastDay)
            )
          )
      : [];

  // ── Aggregate per worker ──────────────────────────────────────────────────────
  const elapsed = daysElapsed(month);
  const byWorker = new Map<string, typeof records>();
  for (const r of records) {
    if (!byWorker.has(r.workerId)) byWorker.set(r.workerId, []);
    byWorker.get(r.workerId)!.push(r);
  }

  const summaries: WorkerSummary[] = workerRows.map((w) => {
    const recs = byWorker.get(w.id) ?? [];
    const present = recs.filter((r) => r.status === "present").length;
    const absent = recs.filter((r) => r.status === "absent").length;
    const leave = recs.filter((r) => r.status === "leave").length;
    const noRecord = Math.max(0, elapsed - recs.length);
    const totalWorkedMinutes = recs.reduce(
      (s, r) => s + (r.workedMinutes ?? 0),
      0
    );
    const lateCount = recs.filter((r) => r.isLate).length;

    return {
      workerId: w.id,
      employeeCode: w.employeeCode,
      fullName: w.fullName,
      deptName: w.deptName ?? "—",
      present,
      absent,
      leave,
      noRecord,
      totalWorkedMinutes,
      lateCount,
    };
  });

  return (
    <ReportsClient
      month={month}
      terminalId={activeTerminalId}
      deptId={activeDeptId}
      visibleTerminals={visibleTerminals.map((t) => ({ id: t.id, name: t.name }))}
      terminalDepts={terminalDepts}
      summaries={summaries}
      daysElapsed={elapsed}
    />
  );
}
