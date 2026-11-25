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
  accessScopes,
  auditLog,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { isCheckoutOverdue } from "@/lib/attendance";
import { getMissingCheckoutHours } from "@/lib/settings";
import { pktDateStr } from "@/lib/pkt-time";
import { canWrite } from "@/lib/access-control";
import {
  AttendanceClient,
  type AttendanceEntry,
} from "./attendance-client";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: { date?: string; terminal?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");

  // Step 33: "today" is the Pakistan date (was the UTC date — wrong 00:00–05:00 PKT).
  const workDate = searchParams.date ?? pktDateStr(new Date());

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
      .from(accessScopes)
      .where(eq(accessScopes.userId, session.user.id));

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

  // Viewer (Step 25) sees identical scoped data to a supervisor on this page
  // but can't edit anything — passed down so the client hides Edit/Absent/
  // Leave instead of rendering buttons that would 401 when clicked.
  const canEdit = canWrite(session.user.role);

  const visibleTerminals = allTerminals.filter((t) =>
    allowedTerminalIds.includes(t.id)
  );
  const activeTerminalId =
    searchParams.terminal ?? visibleTerminals[0]?.id ?? "";

  // ── Workers for this terminal ─────────────────────────────────────────────────
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
            deptName: departments.name,
          })
          .from(workers)
          .leftJoin(departments, eq(workers.departmentId, departments.id))
          .where(
            and(
              eq(workers.terminalId, activeTerminalId),
              eq(workers.status, "active"),
              inArray(workers.departmentId, allowedDeptIds)
            )
          )
          .orderBy(departments.name, workers.fullName)
      : [];

  const workerIds = workerRows.map((w) => w.id);

  // ── Shift overrides for this date (used for "no record yet" rows) ────────────
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

  // ── Attendance records for this date — a worker may have several (Step 19) ───
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

  const recordsByWorker = new Map<string, typeof records>();
  for (const r of records) {
    if (!recordsByWorker.has(r.workerId)) recordsByWorker.set(r.workerId, []);
    recordsByWorker.get(r.workerId)!.push(r);
  }
  for (const list of Array.from(recordsByWorker.values())) {
    list.sort((a, b) => (a.shiftSequence ?? 0) - (b.shiftSequence ?? 0));
  }

  // ── Load all needed shifts — worker defaults/overrides AND each record's own ──
  const shiftIds = new Set<string>();
  workerRows.forEach((w) => { if (w.defaultShiftId) shiftIds.add(w.defaultShiftId); });
  overrides.forEach((o) => shiftIds.add(o.shiftId));
  records.forEach((r) => { if (r.resolvedShiftId) shiftIds.add(r.resolvedShiftId); });

  const shiftRows =
    shiftIds.size > 0
      ? await db
          .select()
          .from(shifts)
          .where(inArray(shifts.id, Array.from(shiftIds)))
      : [];

  const shiftMap = new Map(shiftRows.map((s) => [s.id, s]));

  // Step 33: punches ignored by the minimum-shift rule, per record, so a
  // genuine early departure is visible and can be corrected by hand.
  const recordIds = records.map((r) => r.id);
  const ignoredRows =
    recordIds.length > 0
      ? await db
          .select({ entityId: auditLog.entityId, afterJson: auditLog.afterJson })
          .from(auditLog)
          .where(
            and(
              eq(auditLog.action, "short_punch_ignored"),
              inArray(auditLog.entityId, recordIds)
            )
          )
      : [];
  const ignoredByRecord = new Map<string, string[]>();
  for (const row of ignoredRows) {
    const punchAt = (row.afterJson as { punchAt?: string } | null)?.punchAt;
    if (!punchAt) continue;
    const list = ignoredByRecord.get(row.entityId) ?? [];
    list.push(punchAt);
    ignoredByRecord.set(row.entityId, list.sort());
  }

  const missingCheckoutHours = await getMissingCheckoutHours();

  // ── Build merged entries — one row per record, or one placeholder row ────────
  const now = new Date();

  const entries: AttendanceEntry[] = workerRows.flatMap((w): AttendanceEntry[] => {
    const recs = recordsByWorker.get(w.id) ?? [];

    if (recs.length === 0) {
      const resolvedShiftId = overrideMap.get(w.id) ?? w.defaultShiftId ?? null;
      const shiftRow = resolvedShiftId ? shiftMap.get(resolvedShiftId) : null;
      return [
        {
          workerId: w.id,
          recordId: null,
          shiftSequence: null,
          employeeCode: w.employeeCode,
          fullName: w.fullName,
          deptName: w.deptName ?? "—",
          terminalId: w.terminalId,
          departmentId: w.departmentId,
          resolvedShiftId,
          shiftName: shiftRow?.name ?? null,
          shiftStart: shiftRow?.startTime?.slice(0, 5) ?? null,
          shiftEnd: shiftRow?.endTime?.slice(0, 5) ?? null,
          checkInAt: null,
          checkOutAt: null,
          status: null,
          leaveReason: null,
          isLate: false,
          lateMinutes: 0,
          leftEarly: false,
          earlyLeaveMinutes: 0,
          overtimeMinutes: 0,
          workedMinutes: null,
          checkoutMissing: false,
          ignoredPunches: [],
        },
      ];
    }

    return recs.map((record) => {
      const shiftRow = record.resolvedShiftId ? shiftMap.get(record.resolvedShiftId) : null;

      // Step 33: open for missingCheckoutHours since check-in (not shift
      // end). Auto-closed "incomplete" rows keep their stored flag.
      const checkoutMissing =
        record.status === "present" && record.checkInAt && !record.checkOutAt
          ? isCheckoutOverdue(record.checkInAt, null, now, missingCheckoutHours)
          : record.checkoutMissing;

      return {
        workerId: w.id,
        recordId: record.id,
        shiftSequence: record.shiftSequence,
        employeeCode: w.employeeCode,
        fullName: w.fullName,
        deptName: w.deptName ?? "—",
        terminalId: w.terminalId,
        departmentId: w.departmentId,
        resolvedShiftId: record.resolvedShiftId,
        shiftName: shiftRow?.name ?? null,
        shiftStart: shiftRow?.startTime?.slice(0, 5) ?? null,
        shiftEnd: shiftRow?.endTime?.slice(0, 5) ?? null,
        checkInAt: record.checkInAt?.toISOString() ?? null,
        checkOutAt: record.checkOutAt?.toISOString() ?? null,
        status: record.status,
        leaveReason: record.leaveReason,
        isLate: record.isLate,
        lateMinutes: record.lateMinutes,
        leftEarly: record.leftEarly,
        earlyLeaveMinutes: record.earlyLeaveMinutes,
        overtimeMinutes: record.overtimeMinutes,
        workedMinutes: record.workedMinutes,
        checkoutMissing,
        ignoredPunches: ignoredByRecord.get(record.id) ?? [],
      };
    });
  });

  return (
    <AttendanceClient
      workDate={workDate}
      terminalId={activeTerminalId}
      visibleTerminals={visibleTerminals.map((t) => ({
        id: t.id,
        name: t.name,
      }))}
      entries={entries}
      canEdit={canEdit}
    />
  );
}
