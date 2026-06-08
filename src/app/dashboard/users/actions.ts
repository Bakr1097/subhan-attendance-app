"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import { users, supervisorScopes, auditLog } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";

async function requireAdmin() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Unauthorized");
  return session;
}

async function writeAudit(
  actorUserId: string,
  action: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
) {
  await db.insert(auditLog).values({
    actorUserId,
    action,
    entityType: "user",
    entityId,
    beforeJson: before,
    afterJson: after,
  });
}

async function countOtherActiveAdmins(excludeId: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  return rows.filter((r) => r.id !== excludeId).length;
}

export interface UserCreatePayload {
  name: string;
  email: string;
  password: string;
  role: "admin" | "supervisor";
  terminalId: string | null;
  departmentId: string | null;
}

export interface UserEditPayload {
  name: string;
  email: string;
  role: "admin" | "supervisor";
  terminalId: string | null;
  departmentId: string | null;
}

export async function createUser(payload: UserCreatePayload) {
  const session = await requireAdmin();

  if (!payload.name.trim()) throw new Error("Name is required");
  if (!payload.email.trim()) throw new Error("Email is required");
  if (!payload.password) throw new Error("Password is required");
  if (payload.role === "supervisor" && !payload.terminalId) {
    throw new Error("Terminal is required for supervisors");
  }

  const passwordHash = await hash(payload.password, 12);

  let userId: string;
  try {
    const [inserted] = await db
      .insert(users)
      .values({
        name: payload.name.trim(),
        email: payload.email.trim().toLowerCase(),
        passwordHash,
        role: payload.role,
        isActive: true,
      })
      .returning({ id: users.id });
    userId = inserted.id;
  } catch (e: unknown) {
    if (e instanceof Error && e.message.toLowerCase().includes("unique")) {
      throw new Error("A user with that email already exists");
    }
    throw e;
  }

  if (payload.role === "supervisor" && payload.terminalId) {
    await db.insert(supervisorScopes).values({
      userId,
      terminalId: payload.terminalId,
      departmentId: payload.departmentId || null,
    });
  }

  await writeAudit(session.user.id, "create_user", userId, null, {
    name: payload.name.trim(),
    email: payload.email.trim().toLowerCase(),
    role: payload.role,
  });

  revalidatePath("/dashboard/users");
}

export async function editUser(id: string, payload: UserEditPayload) {
  const session = await requireAdmin();

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!existing) throw new Error("User not found");

  if (id === session.user.id && payload.role !== "admin") {
    throw new Error("You cannot demote your own account");
  }

  if (existing.role === "admin" && payload.role !== "admin") {
    if ((await countOtherActiveAdmins(id)) === 0) {
      throw new Error("Cannot remove the last active admin");
    }
  }

  const before = { name: existing.name, email: existing.email, role: existing.role };
  const newEmail = payload.email.trim().toLowerCase();

  try {
    await db
      .update(users)
      .set({ name: payload.name.trim(), email: newEmail, role: payload.role })
      .where(eq(users.id, id));
  } catch (e: unknown) {
    if (e instanceof Error && e.message.toLowerCase().includes("unique")) {
      throw new Error("A user with that email already exists");
    }
    throw e;
  }

  await db.delete(supervisorScopes).where(eq(supervisorScopes.userId, id));
  if (payload.role === "supervisor" && payload.terminalId) {
    await db.insert(supervisorScopes).values({
      userId: id,
      terminalId: payload.terminalId,
      departmentId: payload.departmentId || null,
    });
  }

  await writeAudit(session.user.id, "edit_user", id, before, {
    name: payload.name.trim(),
    email: newEmail,
    role: payload.role,
  });

  revalidatePath("/dashboard/users");
}

export async function resetPassword(id: string, newPassword: string) {
  const session = await requireAdmin();

  if (!newPassword) throw new Error("Password is required");

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!existing) throw new Error("User not found");

  const passwordHash = await hash(newPassword, 12);
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));

  await writeAudit(session.user.id, "reset_password", id, null, {
    passwordReset: true,
  });

  revalidatePath("/dashboard/users");
}

export async function setUserStatus(id: string, isActive: boolean) {
  const session = await requireAdmin();

  if (id === session.user.id && !isActive) {
    throw new Error("You cannot deactivate your own account");
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!existing) throw new Error("User not found");

  if (!isActive && existing.role === "admin") {
    if ((await countOtherActiveAdmins(id)) === 0) {
      throw new Error("Cannot remove the last active admin");
    }
  }

  await db.update(users).set({ isActive }).where(eq(users.id, id));

  await writeAudit(
    session.user.id,
    isActive ? "reactivate_user" : "deactivate_user",
    id,
    { isActive: !isActive },
    { isActive }
  );

  revalidatePath("/dashboard/users");
}
