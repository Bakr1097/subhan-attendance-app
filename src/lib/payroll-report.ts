import { db } from "@/lib/db";
import { attendanceRecords, shifts, payrollAdjustments } from "@/db/schema";
import { eq, and, gte, lt, inArray } from "drizzle-orm";
import { flagMissingCheckout, type ShiftData } from "@/lib/attendance";

/**
 * Closing-window payroll (Step 18). Wages are settled at a daily closing
 * (default 2:30 PM Pakistan time), not at calendar midnight. A closing for
 * date D covers the rolling window from (D-1) at the cutoff to D at the
 * cutoff — this naturally spans the previous day's evening/night shifts and
 * the current day's morning shift. Supersedes Step 17's calendar-day model.
 */

export type DayStatus = "full" | "half" | "double" | "absent";

export const STATUS_MULTIPLIER: Record<DayStatus, number> = {
  absent: 0,
  half: 0.5,
  full: 1,
  double: 2,
};

const PKT_OFFSET_MINUTES = 5 * 60; // Pakistan is UTC+5, no DST

function pktToUtc(dateStr: string, timeStr: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const utcMinutes = h * 60 + m - PKT_OFFSET_MINUTES;
  return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + utcMinutes * 60_000);
}

function previousDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface ClosingWindow {
  start: Date;
  end: Date;
}

/** Window = [(closingDate - 1) at cutoffTime, closingDate at cutoffTime), in Pakistan local time. */
export function computeClosingWindow(closingDate: string, cutoffTime: string): ClosingWindow {
  return {
    start: pktToUtc(previousDay(closingDate), cutoffTime),
    end: pktToUtc(closingDate, cutoffTime),
  };
}

export interface WorkerPayrollResult {
  workerId: string;
  shiftsWorked: number;
  checkoutMissing: boolean;
  autoStatus: DayStatus;
  status: DayStatus;
}

/**
 * Computes shiftsWorked (count of qualifying check-ins inside the window),
 * whether any qualifying shift has a missing checkout, and the resulting
 * status (manual override from payroll_adjustments, or auto-derived from
 * shiftsWorked) for each worker.
 *
 * A worker can appear with shiftsWorked = 2 (a "double") when their two shift
 * sessions resolve to two different attendance_records rows — e.g. a night
 * shift (workDate = the day it starts) followed by the next morning's shift
 * (workDate = the next day). attendance_records still has a unique
 * (workerId, workDate) constraint inherited from Step 2, so two shifts that
 * both resolve to the SAME workDate would collide into one row rather than
 * counting as two — see HANDOFF.md Step 18 notes.
 */
export async function computePayrollForWorkers(
  workerIds: string[],
  closingDate: string,
  cutoffTime: string
): Promise<Map<string, WorkerPayrollResult>> {
  const result = new Map<string, WorkerPayrollResult>();
  if (workerIds.length === 0) return result;

  const { start, end } = computeClosingWindow(closingDate, cutoffTime);

  const records = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        inArray(attendanceRecords.workerId, workerIds),
        gte(attendanceRecords.checkInAt, start),
        lt(attendanceRecords.checkInAt, end)
      )
    );

  const shiftIds = Array.from(
    new Set(
      records
        .map((r) => r.resolvedShiftId)
        .filter((id): id is string => id !== null)
    )
  );
  const shiftRows =
    shiftIds.length > 0
      ? await db.select().from(shifts).where(inArray(shifts.id, shiftIds))
      : [];
  const shiftMap = new Map(shiftRows.map((s) => [s.id, s]));

  const adjustments = await db
    .select()
    .from(payrollAdjustments)
    .where(
      and(
        eq(payrollAdjustments.closingDate, closingDate),
        inArray(payrollAdjustments.workerId, workerIds)
      )
    );
  const adjustmentMap = new Map(
    adjustments.map((a) => [a.workerId, a.dayStatus as DayStatus])
  );

  const byWorker = new Map<string, typeof records>();
  for (const r of records) {
    if (!byWorker.has(r.workerId)) byWorker.set(r.workerId, []);
    byWorker.get(r.workerId)!.push(r);
  }

  const now = new Date();

  for (const workerId of workerIds) {
    const recs = byWorker.get(workerId) ?? [];
    const shiftsWorked = recs.length;

    const checkoutMissing = recs.some((r) => {
      if (!r.checkInAt || r.checkOutAt) return false;
      const shiftRow = r.resolvedShiftId ? shiftMap.get(r.resolvedShiftId) : null;
      if (!shiftRow) return false;
      const shiftData: ShiftData = {
        startTime: shiftRow.startTime,
        endTime: shiftRow.endTime,
        graceMinutes: shiftRow.graceMinutes,
        earlyLeaveGraceMinutes: shiftRow.earlyLeaveGraceMinutes,
        crossesMidnight: shiftRow.crossesMidnight,
      };
      return flagMissingCheckout(r.checkInAt, null, shiftData, r.workDate, now);
    });

    const autoStatus: DayStatus =
      shiftsWorked === 0 ? "absent" : shiftsWorked === 1 ? "full" : "double";
    const status = adjustmentMap.get(workerId) ?? autoStatus;

    result.set(workerId, { workerId, shiftsWorked, checkoutMissing, autoStatus, status });
  }

  return result;
}
