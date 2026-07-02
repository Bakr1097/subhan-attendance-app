import { db } from "@/lib/db";
import { shifts, shiftAssignments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { ShiftData } from "@/lib/attendance";

/**
 * Resolves the shift to use for a worker on a given day: shift_assignments
 * override first, then the worker's defaultShiftId. Shared by the kiosk,
 * the attendance dashboard corrections, and the biometric punch endpoint.
 */
export async function resolveShiftForWorker(
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
