import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditLog, users, attendanceRecords, workers } from "@/db/schema";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { AuditClient, type AuditEntry } from "./audit-client";

function getPeriodRange(period: string): { from: Date; to: Date } {
  const to = new Date();

  if (period === "today") {
    const from = new Date(
      to.getFullYear(),
      to.getMonth(),
      to.getDate(),
      0, 0, 0, 0
    );
    return { from, to };
  }

  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from, to };
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  const period = ["today", "7d", "30d", "90d"].includes(
    searchParams.period ?? ""
  )
    ? (searchParams.period as string)
    : "30d";

  const { from, to } = getPeriodRange(period);

  // 4-table join: audit_log → users + audit_log → attendance_records → workers
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityId: auditLog.entityId,
      beforeJson: auditLog.beforeJson,
      afterJson: auditLog.afterJson,
      createdAt: auditLog.createdAt,
      actorName: users.name,
      actorEmail: users.email,
      workerName: workers.fullName,
      workerCode: workers.employeeCode,
      workDate: attendanceRecords.workDate,
    })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .leftJoin(
      attendanceRecords,
      eq(auditLog.entityId, attendanceRecords.id)
    )
    .leftJoin(workers, eq(attendanceRecords.workerId, workers.id))
    .where(
      and(
        gte(auditLog.createdAt, from),
        lte(auditLog.createdAt, to)
      )
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(201);

  const capped = rows.length > 200;

  const entries: AuditEntry[] = rows.slice(0, 200).map((r) => ({
    id: r.id,
    action: r.action,
    entityId: r.entityId,
    beforeJson: r.beforeJson as Record<string, unknown> | null,
    afterJson: r.afterJson as Record<string, unknown> | null,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    actorName: r.actorName ?? null,
    actorEmail: r.actorEmail ?? null,
    workerName: r.workerName ?? null,
    workerCode: r.workerCode ?? null,
    workDate: r.workDate ?? null,
  }));

  return (
    <AuditClient period={period} entries={entries} capped={capped} />
  );
}
