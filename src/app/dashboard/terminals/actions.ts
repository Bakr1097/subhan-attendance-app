"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { terminals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function createTerminal(name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Terminal name is required");
  await db.insert(terminals).values({ name: trimmed });
  revalidatePath("/dashboard/terminals");
  revalidatePath("/dashboard");
}

export async function updateTerminal(id: string, name: string) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Terminal name is required");
  await db.update(terminals).set({ name: trimmed }).where(eq(terminals.id, id));
  revalidatePath("/dashboard/terminals");
  revalidatePath("/dashboard");
}

export async function deleteTerminal(id: string) {
  await requireAdmin();
  await db.delete(terminals).where(eq(terminals.id, id));
  revalidatePath("/dashboard/terminals");
  revalidatePath("/dashboard");
}
