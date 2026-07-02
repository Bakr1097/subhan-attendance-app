import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workers, shifts, attendanceRecords } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { computeLate, computeAllFlags, computeWorkedMinutes } from "@/lib/attendance";
import { resolveShiftForWorker } from "@/lib/shift-resolution";

interface Punch {
  deviceUserId: string;
  timestamp: string;
}

function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function previousDay(workDate: string): string {
  const d = new Date(`${workDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDateStr(d);
}

/**
 * Determines the attendance_records work date for a punch.
 *
 * The bridge only sends a raw timestamp — unlike the kiosk, there is no
 * client telling us "today". For a worker whose default shift crosses
 * midnight, a punch landing in the early hours of a calendar day may
 * actually be the checkout for the shift that started the day before, so
 * we check for a still-open record on the previous day first.
 */
async function resolveWorkDate(
  workerId: string,
  defaultShiftId: string | null,
  timestamp: Date
): Promise<string> {
  const rawDate = utcDateStr(timestamp);
  if (!defaultShiftId) return rawDate;

  const [shiftRow] = await db
    .select({ crossesMidnight: shifts.crossesMidnight })
    .from(shifts)
    .where(eq(shifts.id, defaultShiftId))
    .limit(1);

  if (!shiftRow?.crossesMidnight) return rawDate;

  const prevDate = previousDay(rawDate);
  const [prevRecord] = await db
    .select({
      checkInAt: attendanceRecords.checkInAt,
      checkOutAt: attendanceRecords.checkOutAt,
    })
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.workerId, workerId),
        eq(attendanceRecords.workDate, prevDate)
      )
    )
    .limit(1);

  if (prevRecord?.checkInAt && !prevRecord.checkOutAt) return prevDate;

  return rawDate;
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-bridge-secret");
  if (!secret || secret !== process.env.BRIDGE_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawPunches = Array.isArray(body) ? body : [body];

  let checkedIn = 0;
  let checkedOut = 0;
  let duplicates = 0;
  let alreadyComplete = 0;
  const unmatched: string[] = [];

  for (const raw of rawPunches) {
    const punch = raw as Partial<Punch>;
    const deviceUserId =
      typeof punch?.deviceUserId === "string" ? punch.deviceUserId : null;
    const timestamp =
      typeof punch?.timestamp === "string" ? new Date(punch.timestamp) : null;

    if (!deviceUserId || !timestamp || isNaN(timestamp.getTime())) {
      unmatched.push(deviceUserId ?? "");
      continue;
    }

    const [worker] = await db
      .select()
      .from(workers)
      .where(eq(workers.deviceUserId, deviceUserId))
      .limit(1);

    if (!worker) {
      unmatched.push(deviceUserId);
      continue;
    }

    const workDate = await resolveWorkDate(
      worker.id,
      worker.defaultShiftId,
      timestamp
    );

    const { shiftId, shiftData } = await resolveShiftForWorker(
      worker.id,
      workDate,
      worker.defaultShiftId
    );

    const [existing] = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.workerId, worker.id),
          eq(attendanceRecords.workDate, workDate)
        )
      )
      .limit(1);

    const isDuplicate =
      (existing?.checkInAt &&
        existing.checkInAt.getTime() === timestamp.getTime()) ||
      (existing?.checkOutAt &&
        existing.checkOutAt.getTime() === timestamp.getTime());

    if (isDuplicate) {
      duplicates++;
      continue;
    }

    // ── CHECK-IN ────────────────────────────────────────────────────────────
    if (!existing?.checkInAt) {
      const { isLate, lateMinutes } = shiftData
        ? computeLate(timestamp, shiftData, workDate)
        : { isLate: false, lateMinutes: 0 };

      await db
        .insert(attendanceRecords)
        .values({
          workerId: worker.id,
          terminalId: worker.terminalId,
          departmentId: worker.departmentId,
          workDate,
          resolvedShiftId: shiftId,
          checkInAt: timestamp,
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
            checkInAt: timestamp,
            resolvedShiftId: shiftId,
            isLate,
            lateMinutes,
            updatedAt: new Date(),
          },
        });

      checkedIn++;
      continue;
    }

    // ── CHECK-OUT ───────────────────────────────────────────────────────────
    if (!existing.checkOutAt) {
      const now = new Date();
      const flags = shiftData
        ? computeAllFlags(existing.checkInAt, timestamp, shiftData, workDate, now)
        : {
            isLate: existing.isLate,
            lateMinutes: existing.lateMinutes,
            leftEarly: false,
            earlyLeaveMinutes: 0,
            overtimeMinutes: 0,
            workedMinutes: computeWorkedMinutes(existing.checkInAt, timestamp),
            checkoutMissing: false,
          };

      await db
        .update(attendanceRecords)
        .set({
          checkOutAt: timestamp,
          ...flags,
          updatedAt: now,
        })
        .where(eq(attendanceRecords.id, existing.id));

      checkedOut++;
      continue;
    }

    // ── ALREADY COMPLETE ────────────────────────────────────────────────────
    alreadyComplete++;
  }

  return NextResponse.json({
    processed: rawPunches.length,
    checkedIn,
    checkedOut,
    duplicates,
    alreadyComplete,
    unmatched,
  });
}
