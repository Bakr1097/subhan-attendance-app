"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { departments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function createDepartment(terminalId: string, name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Department name is required");
  if (!terminalId) throw new Error("Terminal is required");
  await db.insert(departments).values({ terminalId, name: trimmed });
  revalidatePath("/dashboard/departments");
  revalidatePath("/dashboard");
}

export async function updateDepartment(id: string, name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Department name is required");
  await db
    .update(departments)
    .set({ name: trimmed })
    .where(eq(departments.id, id));
  revalidatePath("/dashboard/departments");
}

export async function deleteDepartment(id: string) {
  await requireAdmin();
  await db.delete(departments).where(eq(departments.id, id));
  revalidatePath("/dashboard/departments");
  revalidatePath("/dashboard");
}
