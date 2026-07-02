import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  workers,
  departments,
  shifts,
  shiftAssignments,
  attendanceRecords,
  supervisorScopes,
} from "@/db/schema";
import { eq, and, gte, lte, inArray } from "drizzle-orm";
import { DetailClient, type DayEntry } from "./detail-client";

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

function getDaysInMonth(ym: string): string[] {
  const [y, m] = ym.split("-").map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) =>
    `${ym}-${String(i + 1).padStart(2, "0")}`
  );
}

export default async function WorkerDetailPage({
  params,
  searchParams,
}: {
  params: { workerId: string };
  searchParams: { month?: string; terminal?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { workerId } = params;
  const month = searchParams.month ?? new Date().toISOString().slice(0, 7);
  const firstDay = `${month}-01`;
  const lastDay = lastDayOfMonth(month);

  // ── Load worker ──────────────────────────────────────────────────────────────
  const [worker] = await db
    .select({
      id: workers.id,
      fullName: workers.fullName,
      employeeCode: workers.employeeCode,
      terminalId: workers.terminalId,
      departmentId: workers.departmentId,
      defaultShiftId: workers.defaultShiftId,
      deptName: departments.name,
    })
    .from(workers)
    .leftJoin(departments, eq(workers.departmentId, departments.id))
    .where(eq(workers.id, workerId))
    .limit(1);

  if (!worker) redirect("/dashboard/reports");

  // ── Scope check ──────────────────────────────────────────────────────────────
  if (session.user.role !== "admin") {
    const scopes = await db
      .select()
      .from(supervisorScopes)
      .where(eq(supervisorScopes.userId, session.user.id));
    const allowed = scopes.some(
      (s) =>
        s.terminalId === worker.terminalId &&
        (s.departmentId === null || s.departmentId === worker.departmentId)
    );
    if (!allowed) redirect("/dashboard/reports");
  }

  // ── Attendance records for the month — a day may have several (Step 19) ──────
  const records = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, workerId),
        gte(attendanceRecords.workDate, firstDay),
        lte(attendanceRecords.workDate, lastDay)
      )
    );

  const recordsByDate = new Map<string, typeof records>();
  for (const r of records) {
    if (!recordsByDate.has(r.workDate)) recordsByDate.set(r.workDate, []);
    recordsByDate.get(r.workDate)!.push(r);
  }
  for (const list of Array.from(recordsByDate.values())) {
    list.sort((a, b) => (a.shiftSequence ?? 0) - (b.shiftSequence ?? 0));
  }

  // ── Shift overrides for the month ─────────────────────────────────────────────
  const overrides = await db
    .select({
      workDate: shiftAssignments.workDate,
      shiftId: shiftAssignments.shiftId,
    })
    .from(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.workerId, workerId),
        gte(shiftAssignments.workDate, firstDay),
        lte(shiftAssignments.workDate, lastDay)
      )
    );

  const overrideMap = new Map(overrides.map((o) => [o.workDate, o.shiftId]));

  // ── Load all referenced shifts — worker default/overrides AND each record's own ─
  const shiftIds = new Set<string>();
  if (worker.defaultShiftId) shiftIds.add(worker.defaultShiftId);
  overrides.forEach((o) => shiftIds.add(o.shiftId));
  records.forEach((r) => { if (r.resolvedShiftId) shiftIds.add(r.resolvedShiftId); });

  const shiftRows =
    shiftIds.size > 0
      ? await db
          .select({ id: shifts.id, name: shifts.name })
          .from(shifts)
          .where(inArray(shifts.id, Array.from(shiftIds)))
      : [];

  const shiftMap = new Map(shiftRows.map((s) => [s.id, s.name]));

  // ── Build day entries — one row per record, or one placeholder row ───────────
  const allDays = getDaysInMonth(month);

  const dayEntries: DayEntry[] = allDays.flatMap((date): DayEntry[] => {
    const recs = recordsByDate.get(date) ?? [];

    if (recs.length === 0) {
      const resolvedShiftId =
        overrideMap.get(date) ?? worker.defaultShiftId ?? null;
      const shiftName = resolvedShiftId
        ? (shiftMap.get(resolvedShiftId) ?? null)
        : null;

      return [
        {
          date,
          shiftSequence: null,
          shiftName,
          checkInAt: null,
          checkOutAt: null,
          status: null,
          workedMinutes: null,
          isLate: false,
          lateMinutes: 0,
          leftEarly: false,
          earlyLeaveMinutes: 0,
          overtimeMinutes: 0,
          checkoutMissing: false,
          leaveReason: null,
        },
      ];
    }

    return recs.map((record) => ({
      date,
      shiftSequence: record.shiftSequence,
      shiftName: record.resolvedShiftId
        ? (shiftMap.get(record.resolvedShiftId) ?? null)
        : null,
      checkInAt: record.checkInAt?.toISOString() ?? null,
      checkOutAt: record.checkOutAt?.toISOString() ?? null,
      status: record.status,
      workedMinutes: record.workedMinutes,
      isLate: record.isLate,
      lateMinutes: record.lateMinutes,
      leftEarly: record.leftEarly,
      earlyLeaveMinutes: record.earlyLeaveMinutes,
      overtimeMinutes: record.overtimeMinutes,
      checkoutMissing: record.checkoutMissing,
      leaveReason: record.leaveReason,
    }));
  });

  const presentDays = new Set(
    records.filter((r) => r.status === "present").map((r) => r.workDate)
  ).size;
  const absentDays = new Set(
    records.filter((r) => r.status === "absent").map((r) => r.workDate)
  ).size;
  const leaveDays = new Set(
    records.filter((r) => r.status === "leave").map((r) => r.workDate)
  ).size;

  const stats = {
    present: presentDays,
    totalShifts: records.filter((r) => r.status === "present").length,
    absent: absentDays,
    leave: leaveDays,
    totalWorkedMinutes: records.reduce((s, r) => s + (r.workedMinutes ?? 0), 0),
    lateCount: records.filter((r) => r.isLate).length,
  };

  return (
    <DetailClient
      worker={{
        id: worker.id,
        fullName: worker.fullName,
        employeeCode: worker.employeeCode,
        deptName: worker.deptName ?? "—",
      }}
      month={month}
      terminalId={searchParams.terminal ?? worker.terminalId}
      days={dayEntries}
      stats={stats}
    />
  );
}
