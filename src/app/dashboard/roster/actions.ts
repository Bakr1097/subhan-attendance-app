"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { shiftAssignments, workers, accessScopes } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { canWrite } from "@/lib/access-control";

// Roster shift overrides write data — a viewer must never reach this
// (Step 25), checked explicitly rather than "role !== admin" so a read-only
// role can't fall through to the scoped-write branch below.
async function requireRosterAccess(workerId: string) {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  if (!canWrite(session.user.role)) throw new Error("Unauthorized");
  if (session.user.role === "admin") return session;

  const [worker] = await db
    .select()
    .from(workers)
    .where(eq(workers.id, workerId))
    .limit(1);

  if (!worker) throw new Error("Worker not found");

  const scopes = await db
    .select()
    .from(accessScopes)
    .where(eq(accessScopes.userId, session.user.id));

  const allowed = scopes.some(
    (s) =>
      s.terminalId === worker.terminalId &&
      (s.departmentId === null || s.departmentId === worker.departmentId)
  );

  if (!allowed) throw new Error("Unauthorized");
  return session;
}

export async function setShiftOverride(
  workerId: string,
  workDate: string,
  shiftId: string
) {
  const session = await requireRosterAccess(workerId);

  await db
    .insert(shiftAssignments)
    .values({ workerId, workDate, shiftId, assignedBy: session.user.id })
    .onConflictDoUpdate({
      target: [shiftAssignments.workerId, shiftAssignments.workDate],
      set: { shiftId, assignedBy: session.user.id },
    });

  revalidatePath("/dashboard/roster");
}

export async function clearShiftOverride(workerId: string, workDate: string) {
  await requireRosterAccess(workerId);

  await db
    .delete(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.workerId, workerId),
        eq(shiftAssignments.workDate, workDate)
      )
    );

  revalidatePath("/dashboard/roster");
}
