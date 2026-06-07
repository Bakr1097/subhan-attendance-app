/**
 * Pure attendance calculation engine.
 * All functions take plain inputs and return plain outputs.
 * No database calls, no React, no side effects.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShiftData {
  startTime: string;            // "HH:MM" or "HH:MM:SS"
  endTime: string;              // "HH:MM" or "HH:MM:SS"
  graceMinutes: number;         // minutes after start before "late"
  earlyLeaveGraceMinutes: number; // minutes before end that are still acceptable
  crossesMidnight: boolean;     // true for night shifts ending the next calendar day
}

export interface LateResult {
  isLate: boolean;
  lateMinutes: number;
}

export interface EarlyLeaveResult {
  leftEarly: boolean;
  earlyLeaveMinutes: number;
}

export interface AttendanceFlags {
  isLate: boolean;
  lateMinutes: number;
  leftEarly: boolean;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number | null;
  checkoutMissing: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build a UTC Date from a YYYY-MM-DD date string and an "HH:MM" time string. */
function buildUtcDate(workDate: string, timeStr: string): Date {
  const hhmm = timeStr.slice(0, 5); // normalise "HH:MM:SS" → "HH:MM"
  return new Date(`${workDate}T${hhmm}:00.000Z`);
}

/** Return the date string for the day after workDate (YYYY-MM-DD). */
function nextDay(workDate: string): string {
  const d = new Date(`${workDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The calendar date on which the shift ends (same day, or next day for night shifts). */
function shiftEndDate(workDate: string, shift: ShiftData): string {
  return shift.crossesMidnight ? nextDay(workDate) : workDate;
}

// ---------------------------------------------------------------------------
// 1. resolveShift
// ---------------------------------------------------------------------------

/**
 * Returns the shift to use for a worker on a given day.
 * Caller looks up both the override (from shift_assignments) and the worker's
 * default shift, then passes them here. The override wins when present.
 */
export function resolveShift(
  defaultShift: ShiftData | null,
  overrideShift: ShiftData | null
): ShiftData | null {
  return overrideShift ?? defaultShift;
}

// ---------------------------------------------------------------------------
// 2. computeLate
// ---------------------------------------------------------------------------

/**
 * Decides whether the worker checked in late and by how many minutes.
 *
 * A worker is late only if check_in_at is AFTER (shift.start_time + grace_minutes).
 * late_minutes is the overage past that threshold, not past the raw start time.
 */
export function computeLate(
  checkInAt: Date | null,
  shift: ShiftData,
  workDate: string
): LateResult {
  if (!checkInAt) return { isLate: false, lateMinutes: 0 };

  const shiftStart = buildUtcDate(workDate, shift.startTime);
  const lateThreshold = new Date(
    shiftStart.getTime() + shift.graceMinutes * 60_000
  );

  if (checkInAt <= lateThreshold) return { isLate: false, lateMinutes: 0 };

  return {
    isLate: true,
    lateMinutes: Math.floor(
      (checkInAt.getTime() - lateThreshold.getTime()) / 60_000
    ),
  };
}

// ---------------------------------------------------------------------------
// 3. computeEarlyLeave
// ---------------------------------------------------------------------------

/**
 * Decides whether the worker left early and by how many minutes.
 *
 * A worker left early if check_out_at is BEFORE (shift.end_time - early_leave_grace_minutes).
 * early_leave_minutes is the shortfall from that threshold.
 * For night shifts the end_time falls on the next calendar day.
 */
export function computeEarlyLeave(
  checkOutAt: Date | null,
  shift: ShiftData,
  workDate: string
): EarlyLeaveResult {
  if (!checkOutAt) return { leftEarly: false, earlyLeaveMinutes: 0 };

  const shiftEnd = buildUtcDate(shiftEndDate(workDate, shift), shift.endTime);
  const earlyThreshold = new Date(
    shiftEnd.getTime() - shift.earlyLeaveGraceMinutes * 60_000
  );

  if (checkOutAt >= earlyThreshold)
    return { leftEarly: false, earlyLeaveMinutes: 0 };

  return {
    leftEarly: true,
    earlyLeaveMinutes: Math.floor(
      (earlyThreshold.getTime() - checkOutAt.getTime()) / 60_000
    ),
  };
}

// ---------------------------------------------------------------------------
// 4. computeOvertime
// ---------------------------------------------------------------------------

/**
 * Returns minutes worked beyond shift.end_time (>= 0).
 * Returns 0 if there is no checkout or the worker left before or at the shift end.
 */
export function computeOvertime(
  checkOutAt: Date | null,
  shift: ShiftData,
  workDate: string
): number {
  if (!checkOutAt) return 0;

  const shiftEnd = buildUtcDate(shiftEndDate(workDate, shift), shift.endTime);

  if (checkOutAt <= shiftEnd) return 0;

  return Math.floor(
    (checkOutAt.getTime() - shiftEnd.getTime()) / 60_000
  );
}

// ---------------------------------------------------------------------------
// 5. computeWorkedMinutes
// ---------------------------------------------------------------------------

/**
 * Returns total minutes between check-in and check-out.
 * Returns null if either timestamp is missing (checkout still open).
 */
export function computeWorkedMinutes(
  checkInAt: Date | null,
  checkOutAt: Date | null
): number | null {
  if (!checkInAt || !checkOutAt) return null;
  const ms = checkOutAt.getTime() - checkInAt.getTime();
  if (ms < 0) return null; // data integrity guard
  return Math.floor(ms / 60_000);
}

// ---------------------------------------------------------------------------
// 6. flagMissingCheckout
// ---------------------------------------------------------------------------

/**
 * Returns true when a worker checked in but never checked out AND the shift
 * end time has already passed (relative to `now`).
 *
 * Does NOT auto-fill check_out_at and does NOT credit any time.
 * The attendance record stays 'present'; a supervisor must supply the real
 * checkout time later.
 */
export function flagMissingCheckout(
  checkInAt: Date | null,
  checkOutAt: Date | null,
  shift: ShiftData,
  workDate: string,
  now: Date
): boolean {
  if (!checkInAt) return false;
  if (checkOutAt) return false;

  const shiftEnd = buildUtcDate(shiftEndDate(workDate, shift), shift.endTime);
  return now > shiftEnd;
}

// ---------------------------------------------------------------------------
// 7. countDaysWorked
// ---------------------------------------------------------------------------

/**
 * Counts attendance records with status === 'present' in the provided set.
 * Used for monthly summaries.
 */
export function countDaysWorked(
  records: ReadonlyArray<{ status: string }>
): number {
  return records.filter((r) => r.status === "present").length;
}

// ---------------------------------------------------------------------------
// 8. computeAllFlags  (convenience wrapper used by the kiosk and dashboard)
// ---------------------------------------------------------------------------

/**
 * Runs all calculations in one call and returns a single flat object ready to
 * be written into attendance_records.
 */
export function computeAllFlags(
  checkInAt: Date | null,
  checkOutAt: Date | null,
  shift: ShiftData,
  workDate: string,
  now: Date
): AttendanceFlags {
  const late = computeLate(checkInAt, shift, workDate);
  const early = computeEarlyLeave(checkOutAt, shift, workDate);

  return {
    ...late,
    ...early,
    overtimeMinutes: computeOvertime(checkOutAt, shift, workDate),
    workedMinutes: computeWorkedMinutes(checkInAt, checkOutAt),
    checkoutMissing: flagMissingCheckout(
      checkInAt,
      checkOutAt,
      shift,
      workDate,
      now
    ),
  };
}
