import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { resolvePunch } from "@/lib/punch-resolution";
import { pktDateStr } from "@/lib/pkt-time";
import { recordUnmatchedDeviceIds } from "@/lib/settings";

interface Punch {
  deviceUserId: string;
  timestamp: string;
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
  let ignored = 0;
  const alreadyComplete = 0;
  const unmatched: string[] = [];
  // Unknown device IDs with a valid timestamp, kept for the Dashboard (Step 30).
  const unmatchedPunches: { deviceUserId: string; timestamp: Date }[] = [];

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
      unmatchedPunches.push({ deviceUserId, timestamp });
      continue;
    }

    // The bridge only sends a raw timestamp — there is no client telling us
    // "today" like the kiosk. This workDate is only used if the punch turns
    // out to be a NEW check-in; an overnight shift's checkout is found and
    // closed by resolvePunch() regardless of workDate (Step 19), so there is
    // no need to guess "does this belong to yesterday's night shift" here.
    // (Step 30) Pakistan-local date, not UTC — the UTC date filed every punch
    // between 00:00 and 04:59 PKT under the previous day.
    const workDate = pktDateStr(timestamp);

    const outcome = await resolvePunch(
      {
        id: worker.id,
        terminalId: worker.terminalId,
        departmentId: worker.departmentId,
        defaultShiftId: worker.defaultShiftId,
      },
      workDate,
      timestamp
    );

    if (outcome.action === "duplicate") {
      duplicates++;
    } else if (outcome.action === "ignored") {
      ignored++;
    } else if (outcome.action === "check-in") {
      checkedIn++;
    } else {
      checkedOut++;
    }
  }

  if (unmatchedPunches.length > 0) {
    await recordUnmatchedDeviceIds(unmatchedPunches);
  }

  return NextResponse.json({
    processed: rawPunches.length,
    checkedIn,
    checkedOut,
    duplicates,
    ignored,
    alreadyComplete,
    unmatched,
  });
}
