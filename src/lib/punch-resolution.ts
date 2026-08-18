import { db } from "@/lib/db";
import { attendanceRecords, shifts, auditLog } from "@/db/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import {
  computeLate,
  computeAllFlags,
  computeWorkedMinutes,
  type ShiftData,
} from "@/lib/attendance";
import { resolveShiftForWorker } from "@/lib/shift-resolution";
import { getMaxOpenShiftHours } from "@/lib/settings";
import { resolveOpenRecords, findDuplicateRecord } from "@/lib/open-shift-cap";

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
 *
 * (Step 27) A worker can have MORE THAN ONE open record at a time — Step 24
 * introduced that possibility (a stale record is auto-closed instead of
 * being deleted, see below) but never taught the resolution logic to expect
 * it. `resolveOpenRecords()` (open-shift-cap.ts) is what makes "which open
 * record is this punch actually for" deterministic instead of arbitrary.
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

/**
 * ALL of the worker's currently-open records — regardless of workDate.
 * (Step 27) There can legitimately be more than one: a stale record is
 * auto-closed to "incomplete" rather than deleted, but until this punch
 * arrives, an old abandoned record and today's genuine one can coexist.
 * "present" excludes anything already auto-closed — an incomplete record
 * must never be picked up again.
 */
async function findOpenRecords(workerId: string) {
  return db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, workerId),
        isNotNull(attendanceRecords.checkInAt),
        isNull(attendanceRecords.checkOutAt),
        eq(attendanceRecords.status, "present")
      )
    );
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
 * - (Step 27) Duplicate detection checks this punch's timestamp against
 *   EVERY one of the worker's records (open, closed, or auto-closed
 *   "incomplete") for an exact match on checkInAt or checkOutAt — not just
 *   whichever record a lookup happened to return. This is what lets the
 *   biometric bridge safely resend a batch after a partial sync failure
 *   (Step 20), regardless of how many open records the worker has.
 * - (Step 24 + 27) Every one of the worker's open records whose checkInAt is
 *   more than `maxOpenShiftHours` before this punch is too old to plausibly
 *   be this punch's checkout (most likely a forgotten checkout). Each such
 *   record is auto-closed — marked "incomplete", never given a checkout
 *   time — so it stays visible as a compliance failure but can never be
 *   picked up again by a later punch. Of whatever open records remain (not
 *   stale), the single most recent is the one this punch closes as a
 *   checkout; if none remain, this punch becomes a new check-in.
 */
export async function resolvePunch(
  worker: PunchWorkerContext,
  workDate: string,
  timestamp: Date,
  options: PunchOptions = {}
): Promise<PunchOutcome> {
  // Duplicate check first, independent of open-record state (Step 27).
  const workerRecords = await db
    .select({
      id: attendanceRecords.id,
      checkInAt: attendanceRecords.checkInAt,
      checkOutAt: attendanceRecords.checkOutAt,
    })
    .from(attendanceRecords)
    .where(eq(attendanceRecords.workerId, worker.id));

  const duplicateId = findDuplicateRecord(workerRecords, timestamp);
  if (duplicateId) {
    return { action: "duplicate", recordId: duplicateId };
  }

  const openRecords = await findOpenRecords(worker.id);
  const now = new Date();

  if (openRecords.length > 0) {
    const maxOpenShiftHours = await getMaxOpenShiftHours();
    const { toClose, current } = resolveOpenRecords(
      openRecords.map((r) => ({ id: r.id, checkInAt: r.checkInAt! })),
      timestamp,
      maxOpenShiftHours
    );

    for (const staleId of toClose) {
      const stale = openRecords.find((r) => r.id === staleId)!;
      await db
        .update(attendanceRecords)
        .set({
          status: "incomplete",
          checkoutMissing: true,
          updatedAt: now,
        })
        .where(eq(attendanceRecords.id, staleId));

      await db.insert(auditLog).values({
        actorUserId: null,
        action: "stale_shift_auto_closed",
        entityType: "attendance_record",
        entityId: staleId,
        beforeJson: { status: "present", checkInAt: stale.checkInAt!.toISOString() },
        afterJson: {
          status: "incomplete",
          checkoutMissing: true,
          newCheckInAt: timestamp.toISOString(),
        },
      });
    }

    if (current) {
      const open = openRecords.find((r) => r.id === current)!;
      const shiftData = await shiftDataFor(open.resolvedShiftId);
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
