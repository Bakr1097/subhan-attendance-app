"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { workers, supervisorScopes, payrollAdjustments, auditLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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

export async function setDayStatus(
  workerId: string,
  workDate: string,
  dayStatus: "full" | "half"
) {
  const session = await requireAccess(workerId);

  const [existing] = await db
    .select()
    .from(payrollAdjustments)
    .where(
      and(
        eq(payrollAdjustments.workerId, workerId),
        eq(payrollAdjustments.workDate, workDate)
      )
    )
    .limit(1);

  const before = { dayStatus: existing?.dayStatus ?? "full" };
  const now = new Date();

  const [row] = await db
    .insert(payrollAdjustments)
    .values({
      workerId,
      workDate,
      dayStatus,
      actorUserId: session.user.id,
    })
    .onConflictDoUpdate({
      target: [payrollAdjustments.workerId, payrollAdjustments.workDate],
      set: { dayStatus, actorUserId: session.user.id, updatedAt: now },
    })
    .returning({ id: payrollAdjustments.id });

  await db.insert(auditLog).values({
    actorUserId: session.user.id,
    action: "payroll_adjust",
    entityType: "payroll_adjustment",
    entityId: row.id,
    beforeJson: before,
    afterJson: { dayStatus },
  });

  revalidatePath("/dashboard/payroll");
}
