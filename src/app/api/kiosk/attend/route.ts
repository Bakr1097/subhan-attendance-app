import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";
import { workers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { uploadToR2 } from "@/lib/r2";
import { resolvePunch } from "@/lib/punch-resolution";

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

  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  const timeStr = `${String(h12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${ampm}`;

  // A new check-in is only allowed when the worker has no open shift; if one
  // exists, this punch closes it instead — this is what allows a genuine
  // second shift the same day (Step 19) once the first has been checked out.
  const outcome = await resolvePunch(
    {
      id: worker.id,
      terminalId: worker.terminalId,
      departmentId: worker.departmentId,
      defaultShiftId: worker.defaultShiftId,
    },
    workDate,
    now,
    { checkInPhotoUrl: photoUrl, checkOutPhotoUrl: photoUrl }
  );

  return NextResponse.json({
    action: outcome.action,
    workerName: worker.fullName,
    timestamp: timeStr,
  });
}
