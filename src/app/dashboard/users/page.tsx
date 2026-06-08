import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users, supervisorScopes, terminals, departments } from "@/db/schema";
import { asc } from "drizzle-orm";
import { UsersClient } from "./users-client";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export default async function UsersPage() {
  const session = await auth();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/dashboard");

  const [allUsers, allScopes, allTerminals, allDepts] = await Promise.all([
    db.select().from(users).orderBy(asc(users.createdAt)),
    db.select().from(supervisorScopes),
    db.select().from(terminals).orderBy(asc(terminals.name)),
    db.select().from(departments).orderBy(asc(departments.name)),
  ]);

  const usersWithScope = allUsers.map((u) => {
    const scope = allScopes.find((s) => s.userId === u.id) ?? null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdAt: fmtDate(u.createdAt ?? null),
      terminalId: scope?.terminalId ?? null,
      departmentId: scope?.departmentId ?? null,
    };
  });

  const terminalMap = Object.fromEntries(allTerminals.map((t) => [t.id, t.name]));
  const deptMap = Object.fromEntries(allDepts.map((d) => [d.id, d.name]));

  return (
    <UsersClient
      users={usersWithScope}
      terminals={allTerminals.map((t) => ({ id: t.id, name: t.name }))}
      departments={allDepts.map((d) => ({ id: d.id, name: d.name, terminalId: d.terminalId }))}
      terminalMap={terminalMap}
      deptMap={deptMap}
      currentUserId={session.user.id}
    />
  );
}
