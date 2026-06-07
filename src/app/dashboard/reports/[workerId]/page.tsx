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

  // ── Attendance records for the month ──────────────────────────────────────────
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

  const recordMap = new Map(records.map((r) => [r.workDate, r]));

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

  // ── Load all referenced shifts ────────────────────────────────────────────────
  const shiftIds = new Set<string>();
  if (worker.defaultShiftId) shiftIds.add(worker.defaultShiftId);
  overrides.forEach((o) => shiftIds.add(o.shiftId));

  const shiftRows =
    shiftIds.size > 0
      ? await db
          .select({ id: shifts.id, name: shifts.name })
          .from(shifts)
          .where(inArray(shifts.id, Array.from(shiftIds)))
      : [];

  const shiftMap = new Map(shiftRows.map((s) => [s.id, s.name]));

  // ── Build day entries ─────────────────────────────────────────────────────────
  const allDays = getDaysInMonth(month);

  const dayEntries: DayEntry[] = allDays.map((date) => {
    const record = recordMap.get(date) ?? null;
    const resolvedShiftId =
      overrideMap.get(date) ?? worker.defaultShiftId ?? null;
    const shiftName = resolvedShiftId
      ? (shiftMap.get(resolvedShiftId) ?? null)
      : null;

    return {
      date,
      shiftName,
      checkInAt: record?.checkInAt?.toISOString() ?? null,
      checkOutAt: record?.checkOutAt?.toISOString() ?? null,
      status: record?.status ?? null,
      workedMinutes: record?.workedMinutes ?? null,
      isLate: record?.isLate ?? false,
      lateMinutes: record?.lateMinutes ?? 0,
      leftEarly: record?.leftEarly ?? false,
      earlyLeaveMinutes: record?.earlyLeaveMinutes ?? 0,
      overtimeMinutes: record?.overtimeMinutes ?? 0,
      checkoutMissing: record?.checkoutMissing ?? false,
      leaveReason: record?.leaveReason ?? null,
    };
  });

  const stats = {
    present: dayEntries.filter((d) => d.status === "present").length,
    absent: dayEntries.filter((d) => d.status === "absent").length,
    leave: dayEntries.filter((d) => d.status === "leave").length,
    totalWorkedMinutes: dayEntries.reduce(
      (s, d) => s + (d.workedMinutes ?? 0),
      0
    ),
    lateCount: dayEntries.filter((d) => d.isLate).length,
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
