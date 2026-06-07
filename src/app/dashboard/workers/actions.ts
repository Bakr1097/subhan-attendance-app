"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { workers, terminals, supervisorScopes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getSession() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  return session;
}

async function requireWorkerAccess(terminalId: string, departmentId: string) {
  const session = await getSession();
  if (session.user.role === "admin") return session;

  const scopes = await db
    .select()
    .from(supervisorScopes)
    .where(eq(supervisorScopes.userId, session.user.id));

  const allowed = scopes.some(
    (s) =>
      s.terminalId === terminalId &&
      (s.departmentId === null || s.departmentId === departmentId)
  );
  if (!allowed) throw new Error("Unauthorized");
  return session;
}

// ─── Employee code generation ─────────────────────────────────────────────────

async function generateEmployeeCode(terminalId: string): Promise<string> {
  const [terminal] = await db
    .select({ name: terminals.name })
    .from(terminals)
    .where(eq(terminals.id, terminalId))
    .limit(1);

  if (!terminal) throw new Error("Terminal not found");

  // Use first 3 letters of the terminal name (letters only, uppercase)
  const prefix = terminal.name
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 3)
    .toUpperCase();

  // Find the highest existing sequence for this terminal
  const existing = await db
    .select({ code: workers.employeeCode })
    .from(workers)
    .where(eq(workers.terminalId, terminalId));

  let maxNum = 0;
  for (const { code } of existing) {
    const match = code.match(/-(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  }

  return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
}

// ─── Payload types ────────────────────────────────────────────────────────────

export interface WorkerCreatePayload {
  terminalId: string;
  departmentId: string;
  defaultShiftId: string;
  fullName: string;
  pin: string;
  cnic: string;
  phone: string;
  referencePhotoUrl: string;
}

export interface WorkerUpdatePayload {
  departmentId: string;
  defaultShiftId: string;
  fullName: string;
  pin: string;
  cnic: string;
  phone: string;
  referencePhotoUrl: string;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function createWorker(payload: WorkerCreatePayload) {
  await requireWorkerAccess(payload.terminalId, payload.departmentId);

  if (!payload.fullName.trim()) throw new Error("Full name is required");
  if (!/^\d{4}$/.test(payload.pin)) throw new Error("PIN must be exactly 4 digits");

  const employeeCode = await generateEmployeeCode(payload.terminalId);
  const pinHash = await hash(payload.pin, 10);

  await db.insert(workers).values({
    terminalId: payload.terminalId,
    departmentId: payload.departmentId,
    defaultShiftId: payload.defaultShiftId || null,
    employeeCode,
    fullName: payload.fullName.trim(),
    pinHash,
    cnic: payload.cnic.trim() || null,
    phone: payload.phone.trim() || null,
    referencePhotoUrl: payload.referencePhotoUrl || null,
    status: "active",
  });

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard");
}

export async function updateWorker(id: string, payload: WorkerUpdatePayload) {
  const session = await getSession();

  const [worker] = await db
    .select()
    .from(workers)
    .where(eq(workers.id, id))
    .limit(1);

  if (!worker) throw new Error("Worker not found");

  await requireWorkerAccess(worker.terminalId, payload.departmentId);

  if (!payload.fullName.trim()) throw new Error("Full name is required");

  const updates: Partial<typeof worker> = {
    departmentId: payload.departmentId,
    defaultShiftId: payload.defaultShiftId || null,
    fullName: payload.fullName.trim(),
    cnic: payload.cnic.trim() || null,
    phone: payload.phone.trim() || null,
    referencePhotoUrl: payload.referencePhotoUrl || null,
  };

  // Only update PIN if a new one is provided
  if (payload.pin) {
    if (!/^\d{4}$/.test(payload.pin)) throw new Error("PIN must be exactly 4 digits");
    updates.pinHash = await hash(payload.pin, 10);
  }

  await db.update(workers).set(updates).where(eq(workers.id, id));

  revalidatePath("/dashboard/workers");
}

export async function setWorkerStatus(
  id: string,
  status: "active" | "inactive"
) {
  const session = await getSession();

  const [worker] = await db
    .select()
    .from(workers)
    .where(eq(workers.id, id))
    .limit(1);

  if (!worker) throw new Error("Worker not found");

  await requireWorkerAccess(worker.terminalId, worker.departmentId);

  await db.update(workers).set({ status }).where(eq(workers.id, id));

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard");
}
