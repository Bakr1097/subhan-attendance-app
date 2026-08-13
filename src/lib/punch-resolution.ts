import { db } from "@/lib/db";
import { attendanceRecords, shifts, auditLog } from "@/db/schema";
import { eq, and, isNull, isNotNull, desc } from "drizzle-orm";
import {
  computeLate,
  computeAllFlags,
  computeWorkedMinutes,
  type ShiftData,
} from "@/lib/attendance";
import { resolveShiftForWorker } from "@/lib/shift-resolution";
import { getMaxOpenShiftHours } from "@/lib/settings";
import { isOpenRecordStale } from "@/lib/open-shift-cap";

/**
 * Shared punch-resolution logic (Step 19) used by both the kiosk
 * (/api/kiosk/attend) and the biometric bridge (/api/biometric/punch).
 *
 * Rule: a new check-in is only allowed when the worker has no open
 * (checked-in-but-not-checked-out) record. If an open record exists, the
 * punch closes it instead of starting a new one — this is what correctly
 * handles both same-day double shifts and overnight shifts closed the next
 * calendar day, without depending on the caller knowing which workDate the
 * open shift was recorded under.
 */

export interface PunchWorkerContext {
  id: string;
  terminalId: string;
  departmentId: string;
  defaultShiftId: string | null;
}

export interface PunchOptions {
  checkInPhotoUrl?: string | null;
  checkOutPhotoUrl?: string | null;
}

export type PunchOutcome =
  | { action: "check-in"; recordId: string }
  | { action: "check-out"; recordId: string }
  | { action: "duplicate"; recordId: string };

/** The worker's currently open record, if any — regardless of workDate. */
export async function findOpenRecord(workerId: string) {
  const [open] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, workerId),
        isNotNull(attendanceRecords.checkInAt),
        isNull(attendanceRecords.checkOutAt)
      )
    )
    .limit(1);
  return open ?? null;
}

async function shiftDataFor(shiftId: string | null): Promise<ShiftData | null> {
  if (!shiftId) return null;
  const [row] = await db.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
  if (!row) return null;
  return {
    startTime: row.startTime,
    endTime: row.endTime,
    graceMinutes: row.graceMinutes,
    earlyLeaveGraceMinutes: row.earlyLeaveGraceMinutes,
    crossesMidnight: row.crossesMidnight,
  };
}

/**
 * Resolves a single punch for a worker at `timestamp`.
 *
 * - If the worker has an open record (any workDate), this punch closes it
 *   (check-out) — using that record's OWN resolvedShiftId and workDate for
 *   flag computation, not today's shift resolution.
 * - Otherwise this punch opens a new record (check-in) on `workDate`, with
 *   shiftSequence = however many records already exist for that worker on
 *   that date, + 1.
 * - A punch whose timestamp exactly matches an already-stored checkInAt (of
 *   the open record) or checkOutAt (of the worker's most recent record) is
 *   reported as a duplicate instead of being applied again — this is what
 *   lets the biometric bridge safely resend a batch after a failed sync.
 * - (Step 24) If the open record's checkInAt is more than `maxOpenShiftHours`
 *   before this punch, it's too old to plausibly be this punch's checkout
 *   (most likely a forgotten checkout followed by a new day's check-in). The
 *   stale record is left open — still surfaced as "Missing checkout" for
 *   manual correction — and this punch becomes a new check-in instead.
 */
export async function resolvePunch(
  worker: PunchWorkerContext,
  workDate: string,
  timestamp: Date,
  options: PunchOptions = {}
): Promise<PunchOutcome> {
  const open = await findOpenRecord(worker.id);

  if (open) {
    if (open.checkInAt && open.checkInAt.getTime() === timestamp.getTime()) {
      return { action: "duplicate", recordId: open.id };
    }

    const maxOpenShiftHours = await getMaxOpenShiftHours();
    const stale = isOpenRecordStale(open.checkInAt!, timestamp, maxOpenShiftHours);

    if (!stale) {
      const shiftData = await shiftDataFor(open.resolvedShiftId);
      const now = new Date();
      const flags = shiftData
        ? computeAllFlags(open.checkInAt!, timestamp, shiftData, open.workDate, now)
        : {
            isLate: open.isLate,
            lateMinutes: open.lateMinutes,
            leftEarly: false,
            earlyLeaveMinutes: 0,
            overtimeMinutes: 0,
            workedMinutes: computeWorkedMinutes(open.checkInAt, timestamp),
            checkoutMissing: false,
          };

      await db
        .update(attendanceRecords)
        .set({
          checkOutAt: timestamp,
          checkOutPhotoUrl: options.checkOutPhotoUrl ?? open.checkOutPhotoUrl,
          ...flags,
          updatedAt: now,
        })
        .where(eq(attendanceRecords.id, open.id));

      return { action: "check-out", recordId: open.id };
    }

    // Stale — leave `open` untouched and fall through to create a new
    // check-in below, same as the "no open record" path.
    await db.insert(auditLog).values({
      actorUserId: null,
      action: "stale_shift_skipped",
      entityType: "attendance_record",
      entityId: open.id,
      beforeJson: { checkInAt: open.checkInAt!.toISOString() },
      afterJson: { newCheckInAt: timestamp.toISOString() },
    });
  } else {
    // No open record — check whether this exact timestamp already closed
    // the worker's most recent shift (a resent checkout punch).
    const [latest] = await db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.workerId, worker.id))
      .orderBy(desc(attendanceRecords.checkInAt))
      .limit(1);

    if (latest?.checkOutAt && latest.checkOutAt.getTime() === timestamp.getTime()) {
      return { action: "duplicate", recordId: latest.id };
    }
  }

  const { shiftId, shiftData } = await resolveShiftForWorker(
    worker.id,
    workDate,
    worker.defaultShiftId
  );

  const { isLate, lateMinutes } = shiftData
    ? computeLate(timestamp, shiftData, workDate)
    : { isLate: false, lateMinutes: 0 };

  const sameDayRecords = await db
    .select({ id: attendanceRecords.id })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, worker.id),
        eq(attendanceRecords.workDate, workDate)
      )
    );
  const shiftSequence = sameDayRecords.length + 1;

  const [inserted] = await db
    .insert(attendanceRecords)
    .values({
      workerId: worker.id,
      terminalId: worker.terminalId,
      departmentId: worker.departmentId,
      workDate,
      shiftSequence,
      resolvedShiftId: shiftId,
      checkInAt: timestamp,
      checkInPhotoUrl: options.checkInPhotoUrl ?? null,
      status: "present",
      isLate,
      lateMinutes,
      leftEarly: false,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      workedMinutes: null,
      checkoutMissing: false,
    })
    .returning({ id: attendanceRecords.id });

  return { action: "check-in", recordId: inserted.id };
}
