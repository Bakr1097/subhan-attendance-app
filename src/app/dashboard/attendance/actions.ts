"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  workers,
  shifts,
  shiftAssignments,
  attendanceRecords,
  supervisorScopes,
  auditLog,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import {
  computeLate,
  computeAllFlags,
  computeWorkedMinutes,
  type ShiftData,
} from "@/lib/attendance";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireAccess(workerId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  if (session.user.role === "admin") return session;

  const [worker] = await db
    .select()
    .from(workers)
    .where(eq(workers.id, workerId))
    .limit(1);
  if (!worker) throw new Error("Worker not found");

  const scopes = await db
    .select()
    .from(supervisorScopes)
    .where(eq(supervisorScopes.userId, session.user.id));

  const allowed = scopes.some(
    (s) =>
      s.terminalId === worker.terminalId &&
      (s.departmentId === null || s.departmentId === worker.departmentId)
  );
  if (!allowed) throw new Error("Unauthorized");
  return session;
}

async function resolveShift(
  workerId: string,
  workDate: string,
  defaultShiftId: string | null
): Promise<{ shiftId: string | null; shiftData: ShiftData | null }> {
  const [override] = await db
    .select({ shiftId: shiftAssignments.shiftId })
    .from(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.workerId, workerId),
        eq(shiftAssignments.workDate, workDate)
      )
    )
    .limit(1);

  const shiftId = override?.shiftId ?? defaultShiftId ?? null;
  if (!shiftId) return { shiftId: null, shiftData: null };

  const [row] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);

  if (!row) return { shiftId, shiftData: null };

  return {
    shiftId,
    shiftData: {
      startTime: row.startTime,
      endTime: row.endTime,
      graceMinutes: row.graceMinutes,
      earlyLeaveGraceMinutes: row.earlyLeaveGraceMinutes,
      crossesMidnight: row.crossesMidnight,
    },
  };
}

async function writeAudit(
  actorUserId: string,
  action: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
) {
  await db.insert(auditLog).values({
    actorUserId,
    action,
    entityType: "attendance_record",
    entityId,
    beforeJson: before,
    afterJson: after,
  });
}

// ─── correctAttendance ────────────────────────────────────────────────────────

export interface CorrectionPayload {
  workerId: string;
  workDate: string;
  terminalId: string;
  departmentId: string;
  checkInISO: string | null;
  checkOutISO: string | null;
}

export async function correctAttendance(payload: CorrectionPayload) {
  const session = await requireAccess(payload.workerId);

  const [worker] = await db
    .select()
    .from(workers)
    .where(eq(workers.id, payload.workerId))
    .limit(1);
  if (!worker) throw new Error("Worker not found");

  const { shiftId, shiftData } = await resolveShift(
    payload.workerId,
    payload.workDate,
    worker.defaultShiftId ?? null
  );

  const checkInAt = payload.checkInISO ? new Date(payload.checkInISO) : null;
  const checkOutAt = payload.checkOutISO ? new Date(payload.checkOutISO) : null;
  const now = new Date();

  const flags = shiftData
    ? computeAllFlags(checkInAt, checkOutAt, shiftData, payload.workDate, now)
    : {
        isLate: false,
        lateMinutes: 0,
        leftEarly: false,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        workedMinutes: computeWorkedMinutes(checkInAt, checkOutAt),
        checkoutMissing: false,
      };

  // Load existing record to capture before-snapshot and decide insert vs update
  const [existing] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, payload.workerId),
        eq(attendanceRecords.workDate, payload.workDate)
      )
    )
    .limit(1);

  const before: Record<string, unknown> | null = existing
    ? {
        checkInAt: existing.checkInAt?.toISOString() ?? null,
        checkOutAt: existing.checkOutAt?.toISOString() ?? null,
        status: existing.status,
        isLate: existing.isLate,
        lateMinutes: existing.lateMinutes,
        leftEarly: existing.leftEarly,
        earlyLeaveMinutes: existing.earlyLeaveMinutes,
        overtimeMinutes: existing.overtimeMinutes,
        workedMinutes: existing.workedMinutes,
        checkoutMissing: existing.checkoutMissing,
      }
    : null;

  const after: Record<string, unknown> = {
    checkInAt: checkInAt?.toISOString() ?? null,
    checkOutAt: checkOutAt?.toISOString() ?? null,
    status: "present",
    ...flags,
  };

  let recordId: string;

  if (existing) {
    await db
      .update(attendanceRecords)
      .set({
        checkInAt,
        checkOutAt,
        status: "present",
        leaveReason: null,
        resolvedShiftId: shiftId,
        ...flags,
        updatedAt: now,
      })
      .where(eq(attendanceRecords.id, existing.id));
    recordId = existing.id;
  } else {
    const [inserted] = await db
      .insert(attendanceRecords)
      .values({
        workerId: payload.workerId,
        terminalId: payload.terminalId,
        departmentId: payload.departmentId,
        workDate: payload.workDate,
        resolvedShiftId: shiftId,
        checkInAt,
        checkOutAt,
        status: "present",
        leaveReason: null,
        ...flags,
      })
      .returning({ id: attendanceRecords.id });
    recordId = inserted.id;
  }

  await writeAudit(
    session.user.id,
    existing ? "correct_times" : "create_record",
    recordId,
    before,
    after
  );

  revalidatePath("/dashboard/attendance");
}

// ─── markAbsent ───────────────────────────────────────────────────────────────

export async function markAbsent(
  workerId: string,
  workDate: string,
  terminalId: string,
  departmentId: string
) {
  const session = await requireAccess(workerId);

  const [existing] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, workerId),
        eq(attendanceRecords.workDate, workDate)
      )
    )
    .limit(1);

  const before: Record<string, unknown> | null = existing
    ? {
        status: existing.status,
        checkInAt: existing.checkInAt?.toISOString() ?? null,
        checkOutAt: existing.checkOutAt?.toISOString() ?? null,
        leaveReason: existing.leaveReason,
      }
    : null;

  const now = new Date();
  const absentFields = {
    status: "absent" as const,
    checkInAt: null,
    checkOutAt: null,
    checkInPhotoUrl: null,
    checkOutPhotoUrl: null,
    leaveReason: null,
    resolvedShiftId: null,
    isLate: false,
    lateMinutes: 0,
    leftEarly: false,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    workedMinutes: null,
    checkoutMissing: false,
  };

  let recordId: string;

  if (existing) {
    await db
      .update(attendanceRecords)
      .set({ ...absentFields, updatedAt: now })
      .where(eq(attendanceRecords.id, existing.id));
    recordId = existing.id;
  } else {
    const [inserted] = await db
      .insert(attendanceRecords)
      .values({ workerId, terminalId, departmentId, workDate, ...absentFields })
      .returning({ id: attendanceRecords.id });
    recordId = inserted.id;
  }

  await writeAudit(session.user.id, "mark_absent", recordId, before, {
    status: "absent",
    checkInAt: null,
    checkOutAt: null,
  });

  revalidatePath("/dashboard/attendance");
}

// ─── markLeave ────────────────────────────────────────────────────────────────

export async function markLeave(
  workerId: string,
  workDate: string,
  terminalId: string,
  departmentId: string,
  reason: string
) {
  const session = await requireAccess(workerId);

  const [existing] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, workerId),
        eq(attendanceRecords.workDate, workDate)
      )
    )
    .limit(1);

  const before: Record<string, unknown> | null = existing
    ? {
        status: existing.status,
        checkInAt: existing.checkInAt?.toISOString() ?? null,
        checkOutAt: existing.checkOutAt?.toISOString() ?? null,
        leaveReason: existing.leaveReason,
      }
    : null;

  const now = new Date();
  const trimmedReason = reason.trim() || null;
  const leaveFields = {
    status: "leave" as const,
    leaveReason: trimmedReason,
    checkInAt: null,
    checkOutAt: null,
    checkInPhotoUrl: null,
    checkOutPhotoUrl: null,
    resolvedShiftId: null,
    isLate: false,
    lateMinutes: 0,
    leftEarly: false,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    workedMinutes: null,
    checkoutMissing: false,
  };

  let recordId: string;

  if (existing) {
    await db
      .update(attendanceRecords)
      .set({ ...leaveFields, updatedAt: now })
      .where(eq(attendanceRecords.id, existing.id));
    recordId = existing.id;
  } else {
    const [inserted] = await db
      .insert(attendanceRecords)
      .values({ workerId, terminalId, departmentId, workDate, ...leaveFields })
      .returning({ id: attendanceRecords.id });
    recordId = inserted.id;
  }

  await writeAudit(session.user.id, "mark_leave", recordId, before, {
    status: "leave",
    leaveReason: trimmedReason,
  });

  revalidatePath("/dashboard/attendance");
}
