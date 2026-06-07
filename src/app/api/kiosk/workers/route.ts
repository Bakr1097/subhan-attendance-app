import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workers, departments, attendanceRecords } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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

  const records =
    workerRows.length > 0
      ? await db
          .select({
            workerId: attendanceRecords.workerId,
            checkInAt: attendanceRecords.checkInAt,
            checkOutAt: attendanceRecords.checkOutAt,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.terminalId, terminalId),
              eq(attendanceRecords.workDate, workDate)
            )
          )
      : [];

  const recordMap = new Map(records.map((r) => [r.workerId, r]));

  const result = workerRows.map((w) => {
    const rec = recordMap.get(w.id);
    return {
      id: w.id,
      employeeCode: w.employeeCode,
      fullName: w.fullName,
      referencePhotoUrl: w.referencePhotoUrl ?? null,
      deptName: w.deptName ?? "—",
      checkedIn: !!rec?.checkInAt,
      checkedOut: !!rec?.checkOutAt,
    };
  });

  return NextResponse.json({ workers: result });
}
