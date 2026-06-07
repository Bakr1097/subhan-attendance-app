"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { shifts, workers, shiftAssignments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }
}

export interface ShiftPayload {
  terminalId: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  earlyLeaveGraceMinutes: number;
  crossesMidnight: boolean;
}

export async function createShift(payload: ShiftPayload) {
  await requireAdmin();
  if (!payload.name.trim()) throw new Error("Shift name is required");
  if (!payload.terminalId) throw new Error("Terminal is required");
  if (!payload.startTime) throw new Error("Start time is required");
  if (!payload.endTime) throw new Error("End time is required");

  await db.insert(shifts).values({
    terminalId: payload.terminalId,
    name: payload.name.trim(),
    startTime: payload.startTime,
    endTime: payload.endTime,
    graceMinutes: payload.graceMinutes,
    earlyLeaveGraceMinutes: payload.earlyLeaveGraceMinutes,
    crossesMidnight: payload.crossesMidnight,
  });

  revalidatePath("/dashboard/shifts");
}

export async function updateShift(id: string, payload: ShiftPayload) {
  await requireAdmin();
  if (!payload.name.trim()) throw new Error("Shift name is required");
  if (!payload.startTime) throw new Error("Start time is required");
  if (!payload.endTime) throw new Error("End time is required");

  await db
    .update(shifts)
    .set({
      name: payload.name.trim(),
      startTime: payload.startTime,
      endTime: payload.endTime,
      graceMinutes: payload.graceMinutes,
      earlyLeaveGraceMinutes: payload.earlyLeaveGraceMinutes,
      crossesMidnight: payload.crossesMidnight,
    })
    .where(eq(shifts.id, id));

  revalidatePath("/dashboard/shifts");
}

export async function deleteShift(id: string) {
  await requireAdmin();

  const [workerRef] = await db
    .select({ id: workers.id })
    .from(workers)
    .where(eq(workers.defaultShiftId, id))
    .limit(1);

  if (workerRef) {
    throw new Error(
      "This shift is set as the default for one or more workers. Reassign those workers before deleting."
    );
  }

  const [assignRef] = await db
    .select({ id: shiftAssignments.id })
    .from(shiftAssignments)
    .where(eq(shiftAssignments.shiftId, id))
    .limit(1);

  if (assignRef) {
    throw new Error(
      "This shift has roster assignments linked to it. Remove those assignments before deleting."
    );
  }

  await db.delete(shifts).where(eq(shifts.id, id));
  revalidatePath("/dashboard/shifts");
}
