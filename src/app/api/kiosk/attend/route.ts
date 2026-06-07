import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import {
  workers,
  shifts,
  shiftAssignments,
  attendanceRecords,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { uploadToR2 } from "@/lib/r2";
import {
  computeLate,
  computeAllFlags,
  computeWorkedMinutes,
  type ShiftData,
} from "@/lib/attendance";

export async function POST(req: NextRequest) {
  let body: { workerId?: string; pin?: string; photoBase64?: string | null; workDate?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { workerId, pin, photoBase64, workDate } = body;

  if (!workerId || !pin || !workDate) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "Invalid PIN format" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  // Load worker
  const [worker] = await db
    .select()
    .from(workers)
    .where(and(eq(workers.id, workerId), eq(workers.status, "active")))
    .limit(1);

  if (!worker) {
    return NextResponse.json({ error: "Worker not found" }, { status: 404 });
  }

  // Verify PIN
  const pinValid = await compare(pin, worker.pinHash);
  if (!pinValid) {
    return NextResponse.json({ error: "Incorrect PIN. Please try again." }, { status: 401 });
  }

  // Upload photo to R2 if provided (non-fatal if it fails)
  let photoUrl: string | null = null;
  if (photoBase64 && typeof photoBase64 === "string" && photoBase64.startsWith("data:image/")) {
    try {
      const base64Data = photoBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const isPng = photoBase64.startsWith("data:image/png");
      const ext = isPng ? "png" : "jpg";
      const contentType = isPng ? "image/png" : "image/jpeg";
      const key = `kiosk/${workDate}/${workerId}-${Date.now()}.${ext}`;
      photoUrl = await uploadToR2(key, buffer, contentType);
    } catch {
      photoUrl = null;
    }
  }

  // Check existing attendance record for today
  const [existing] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, workerId),
        eq(attendanceRecords.workDate, workDate)
      )
    )
    .limit(1);

  if (existing?.checkInAt && existing?.checkOutAt) {
    return NextResponse.json(
      { error: "Attendance is already complete for today." },
      { status: 409 }
    );
  }

  // Resolve shift (override first, then worker default)
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

  const resolvedShiftId = override?.shiftId ?? worker.defaultShiftId ?? null;

  let shiftData: ShiftData | null = null;
  if (resolvedShiftId) {
    const [shiftRow] = await db
      .select()
      .from(shifts)
      .where(eq(shifts.id, resolvedShiftId))
      .limit(1);

    if (shiftRow) {
      shiftData = {
        startTime: shiftRow.startTime,
        endTime: shiftRow.endTime,
        graceMinutes: shiftRow.graceMinutes,
        earlyLeaveGraceMinutes: shiftRow.earlyLeaveGraceMinutes,
        crossesMidnight: shiftRow.crossesMidnight,
      };
    }
  }

  const now = new Date();

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  const timeStr = `${String(h12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${ampm}`;

  // ── CHECK-IN ──────────────────────────────────────────────────────────────────
  if (!existing?.checkInAt) {
    const { isLate, lateMinutes } = shiftData
      ? computeLate(now, shiftData, workDate)
      : { isLate: false, lateMinutes: 0 };

    await db
      .insert(attendanceRecords)
      .values({
        workerId,
        terminalId: worker.terminalId,
        departmentId: worker.departmentId,
        workDate,
        resolvedShiftId,
        checkInAt: now,
        checkInPhotoUrl: photoUrl,
        status: "present",
        isLate,
        lateMinutes,
        leftEarly: false,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        workedMinutes: null,
        checkoutMissing: false,
      })
      .onConflictDoUpdate({
        target: [attendanceRecords.workerId, attendanceRecords.workDate],
        set: {
          checkInAt: now,
          checkInPhotoUrl: photoUrl,
          resolvedShiftId,
          isLate,
          lateMinutes,
          updatedAt: now,
        },
      });

    return NextResponse.json({
      action: "check-in",
      workerName: worker.fullName,
      timestamp: timeStr,
    });
  }

  // ── CHECK-OUT ─────────────────────────────────────────────────────────────────
  const checkInAt = existing.checkInAt!;

  const flags = shiftData
    ? computeAllFlags(checkInAt, now, shiftData, workDate, now)
    : {
        isLate: existing.isLate,
        lateMinutes: existing.lateMinutes,
        leftEarly: false,
        earlyLeaveMinutes: 0,
        overtimeMinutes: 0,
        workedMinutes: computeWorkedMinutes(checkInAt, now),
        checkoutMissing: false,
      };

  await db
    .update(attendanceRecords)
    .set({
      checkOutAt: now,
      checkOutPhotoUrl: photoUrl,
      ...flags,
      updatedAt: now,
    })
    .where(eq(attendanceRecords.id, existing.id));

  return NextResponse.json({
    action: "check-out",
    workerName: worker.fullName,
    timestamp: timeStr,
  });
}
