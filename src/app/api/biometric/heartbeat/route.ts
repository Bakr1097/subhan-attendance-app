import { NextRequest, NextResponse } from "next/server";
import { recordBiometricHeartbeat } from "@/lib/settings";

interface HeartbeatBody {
  ranAt: string;
  success: boolean;
  recordsSynced: number;
  message?: string;
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

  const b = body as Partial<HeartbeatBody>;
  const ranAt = typeof b.ranAt === "string" ? b.ranAt : null;
  const success = typeof b.success === "boolean" ? b.success : null;
  const recordsSynced =
    typeof b.recordsSynced === "number" && Number.isFinite(b.recordsSynced)
      ? b.recordsSynced
      : null;
  const message = typeof b.message === "string" ? b.message : null;

  if (!ranAt || isNaN(new Date(ranAt).getTime()) || success === null || recordsSynced === null) {
    return NextResponse.json({ error: "Invalid heartbeat payload" }, { status: 400 });
  }

  await recordBiometricHeartbeat({ ranAt, success, recordsSynced, message });

  return NextResponse.json({ ok: true });
}
