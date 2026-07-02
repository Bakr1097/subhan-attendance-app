import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  workers,
  departments,
  shifts,
  terminals,
  shiftAssignments,
  attendanceRecords,
  payrollAdjustments,
  supervisorScopes,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { flagMissingCheckout, type ShiftData } from "@/lib/attendance";
import { PayrollClient, type PayrollEntry } from "./payroll-client";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: { date?: string; terminal?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const workDate = searchParams.date ?? new Date().toISOString().slice(0, 10);

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
            defaultShiftId: workers.defaultShiftId,
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

  // ── Shift overrides for this date ─────────────────────────────────────────────
  const overrides =
    workerIds.length > 0
      ? await db
          .select({
            workerId: shiftAssignments.workerId,
            shiftId: shiftAssignments.shiftId,
          })
          .from(shiftAssignments)
          .where(
            and(
              eq(shiftAssignments.workDate, workDate),
              inArray(shiftAssignments.workerId, workerIds)
            )
          )
      : [];

  const overrideMap = new Map(overrides.map((o) => [o.workerId, o.shiftId]));

  const shiftIds = new Set<string>();
  workerRows.forEach((w) => { if (w.defaultShiftId) shiftIds.add(w.defaultShiftId); });
  overrides.forEach((o) => shiftIds.add(o.shiftId));

  const shiftRows =
    shiftIds.size > 0
      ? await db
          .select()
          .from(shifts)
          .where(inArray(shifts.id, Array.from(shiftIds)))
      : [];

  const shiftMap = new Map(shiftRows.map((s) => [s.id, s]));

  // ── Attendance records for this date ─────────────────────────────────────────
  const records =
    workerIds.length > 0
      ? await db
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.workDate, workDate),
              inArray(attendanceRecords.workerId, workerIds)
            )
          )
      : [];

  const recordMap = new Map(records.map((r) => [r.workerId, r]));

  // ── Half-day adjustments for this date ────────────────────────────────────────
  const adjustments =
    workerIds.length > 0
      ? await db
          .select()
          .from(payrollAdjustments)
          .where(
            and(
              eq(payrollAdjustments.workDate, workDate),
              inArray(payrollAdjustments.workerId, workerIds)
            )
          )
      : [];

  const adjustmentMap = new Map(adjustments.map((a) => [a.workerId, a.dayStatus]));

  // ── Build entries ──────────────────────────────────────────────────────────────
  const now = new Date();

  const entries: PayrollEntry[] = workerRows.map((w) => {
    const resolvedShiftId = overrideMap.get(w.id) ?? w.defaultShiftId ?? null;
    const shiftRow = resolvedShiftId ? shiftMap.get(resolvedShiftId) : null;
    const record = recordMap.get(w.id) ?? null;

    const shiftData: ShiftData | null = shiftRow
      ? {
          startTime: shiftRow.startTime,
          endTime: shiftRow.endTime,
          graceMinutes: shiftRow.graceMinutes,
          earlyLeaveGraceMinutes: shiftRow.earlyLeaveGraceMinutes,
          crossesMidnight: shiftRow.crossesMidnight,
        }
      : null;

    const present = !!record?.checkInAt;

    const checkoutMissing =
      present && record?.checkInAt && !record?.checkOutAt && shiftData
        ? flagMissingCheckout(record.checkInAt, null, shiftData, workDate, now)
        : (record?.checkoutMissing ?? false);

    const dayStatus: "full" | "half" = present
      ? (adjustmentMap.get(w.id) as "full" | "half" | undefined) ?? "full"
      : "full";

    const dailyRate = w.dailyRate ?? 0;
    const amount = !present ? 0 : dayStatus === "half" ? Math.round(dailyRate / 2) : dailyRate;

    return {
      workerId: w.id,
      employeeCode: w.employeeCode,
      fullName: w.fullName,
      deptName: w.deptName ?? "—",
      terminalId: w.terminalId,
      departmentId: w.departmentId,
      dailyRate,
      present,
      checkoutMissing,
      dayStatus,
      amount,
    };
  });

  return (
    <PayrollClient
      workDate={workDate}
      terminalId={activeTerminalId}
      visibleTerminals={visibleTerminals.map((t) => ({ id: t.id, name: t.name }))}
      entries={entries}
    />
  );
}
