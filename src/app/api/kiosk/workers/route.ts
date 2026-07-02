import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workers, departments, attendanceRecords } from "@/db/schema";
import { eq, and, isNull, isNotNull } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const terminalId = req.nextUrl.searchParams.get("terminal");
  const workDate = req.nextUrl.searchParams.get("date");

  if (!terminalId || !workDate) {
    return NextResponse.json({ error: "terminal and date are required" }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  const workerRows = await db
    .select({
      id: workers.id,
      employeeCode: workers.employeeCode,
      fullName: workers.fullName,
      referencePhotoUrl: workers.referencePhotoUrl,
      deptName: departments.name,
    })
    .from(workers)
    .leftJoin(departments, eq(workers.departmentId, departments.id))
    .where(and(eq(workers.terminalId, terminalId), eq(workers.status, "active")))
    .orderBy(workers.fullName);

  // "Checked in" means "has an open shift right now" — regardless of
  // workDate, so an overnight shift still shows correctly, and once a shift
  // is closed a worker is available to check in again the same day (Step 19).
  const openRecords =
    workerRows.length > 0
      ? await db
          .select({ workerId: attendanceRecords.workerId })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.terminalId, terminalId),
              isNotNull(attendanceRecords.checkInAt),
              isNull(attendanceRecords.checkOutAt)
            )
          )
      : [];

  const openSet = new Set(openRecords.map((r) => r.workerId));

  const result = workerRows.map((w) => ({
    id: w.id,
    employeeCode: w.employeeCode,
    fullName: w.fullName,
    referencePhotoUrl: w.referencePhotoUrl ?? null,
    deptName: w.deptName ?? "—",
    checkedIn: openSet.has(w.id),
  }));

  return NextResponse.json({ workers: result });
}
