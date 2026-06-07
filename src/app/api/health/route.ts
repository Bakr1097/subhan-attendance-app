import { NextResponse } from "next/server";
import { pingDb } from "@/lib/db";

export async function GET() {
  const dbOk = await pingDb();
  return NextResponse.json(
    { status: dbOk ? "ok" : "db_error", db: dbOk },
    { status: dbOk ? 200 : 503 }
  );
}
