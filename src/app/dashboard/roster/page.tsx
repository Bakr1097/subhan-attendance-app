import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  workers,
  departments,
  shifts,
  terminals,
  shiftAssignments,
  supervisorScopes,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import {
  DateNavigator,
  RosterTable,
  type RosterEntry,
} from "./roster-client";

export default async function RosterPage({
  searchParams,
}: {
  searchParams: { date?: string; terminal?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");

  // ── Default date = today (UTC) ──────────────────────────────────────────────
  const workDate =
    searchParams.date ?? new Date().toISOString().slice(0, 10);

  // ── Load terminals scoped to user ───────────────────────────────────────────
  const allTerminals = await db
    .select()
    .from(terminals)
    .orderBy(terminals.createdAt);

  let allowedTerminalIds: string[];
  let allowedDeptIds: string[];

  if (session.user.role === "admin") {
    allowedTerminalIds = allTerminals.map((t) => t.id);
    allowedDeptIds = (await db.select({ id: departments.id }).from(departments)).map(
      (d) => d.id
    );
  } else {
    const scopes = await db
      .select()
      .from(supervisorScopes)
      .where(eq(supervisorScopes.userId, session.user.id));

    allowedTerminalIds = Array.from(new Set(scopes.map((s) => s.terminalId)));

    const allDepts = await db.select().from(departments);
    const ids: string[] = [];
    for (const scope of scopes) {
      if (scope.departmentId) {
        ids.push(scope.departmentId);
      } else {
        allDepts
          .filter((d) => d.terminalId === scope.terminalId)
          .forEach((d) => ids.push(d.id));
      }
    }
    allowedDeptIds = Array.from(new Set(ids));
  }

  const visibleTerminals = allTerminals.filter((t) =>
    allowedTerminalIds.includes(t.id)
  );

  const activeTerminalId =
    searchParams.terminal ?? visibleTerminals[0]?.id ?? "";

  // ── Load workers for this terminal (active only) ────────────────────────────
  const workerRows =
    activeTerminalId
      ? await db
          .select({
            id: workers.id,
            employeeCode: workers.employeeCode,
            fullName: workers.fullName,
            departmentId: workers.departmentId,
            defaultShiftId: workers.defaultShiftId,
            deptName: departments.name,
            defaultShiftName: shifts.name,
          })
          .from(workers)
          .leftJoin(departments, eq(workers.departmentId, departments.id))
          .leftJoin(shifts, eq(workers.defaultShiftId, shifts.id))
          .where(
            and(
              eq(workers.terminalId, activeTerminalId),
              eq(workers.status, "active"),
              inArray(workers.departmentId, allowedDeptIds)
            )
          )
          .orderBy(departments.name, workers.fullName)
      : [];

  // ── Load shift overrides for this date ──────────────────────────────────────
  const workerIds = workerRows.map((w) => w.id);
  const overrides =
    workerIds.length > 0
      ? await db
          .select({
            workerId: shiftAssignments.workerId,
            shiftId: shiftAssignments.shiftId,
            shiftName: shifts.name,
          })
          .from(shiftAssignments)
          .leftJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
          .where(
            and(
              eq(shiftAssignments.workDate, workDate),
              inArray(shiftAssignments.workerId, workerIds)
            )
          )
      : [];

  const overrideMap = new Map(
    overrides.map((o) => [o.workerId, { id: o.shiftId, name: o.shiftName }])
  );

  // ── Build merged roster entries ─────────────────────────────────────────────
  const entries: RosterEntry[] = workerRows.map((w) => {
    const override = overrideMap.get(w.id) ?? null;
    return {
      workerId: w.id,
      employeeCode: w.employeeCode,
      fullName: w.fullName,
      deptName: w.deptName ?? "—",
      defaultShiftId: w.defaultShiftId,
      defaultShiftName: w.defaultShiftName ?? null,
      overrideShiftId: override?.id ?? null,
      overrideShiftName: override?.name ?? null,
    };
  });

  // ── Load available shifts for the selector ──────────────────────────────────
  const terminalShifts = activeTerminalId
    ? await db
        .select({ id: shifts.id, name: shifts.name })
        .from(shifts)
        .where(eq(shifts.terminalId, activeTerminalId))
        .orderBy(shifts.name)
    : [];

  const overrideCount = entries.filter((e) => e.overrideShiftId !== null).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Roster</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Assign shift overrides for workers not on their default schedule
          </p>
        </div>
        <DateNavigator
          date={workDate}
          terminalId={activeTerminalId}
        />
      </div>

      {visibleTerminals.length === 0 ? (
        <div className="border rounded-lg bg-white p-10 text-center text-muted-foreground">
          No terminals available.
        </div>
      ) : (
        <>
          {/* Terminal tabs */}
          <div className="flex gap-2 flex-wrap">
            {visibleTerminals.map((t) => (
              <a
                key={t.id}
                href={`/dashboard/roster?date=${workDate}&terminal=${t.id}`}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  t.id === activeTerminalId
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-muted-foreground border-border hover:bg-slate-50"
                }`}
              >
                {t.name}
              </a>
            ))}
          </div>

          {/* Summary bar */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">
                {entries.length}
              </span>{" "}
              active workers
            </span>
            {overrideCount > 0 && (
              <>
                <span>·</span>
                <span className="text-amber-700">
                  <span className="font-semibold">{overrideCount}</span> with
                  override
                </span>
              </>
            )}
            {terminalShifts.length === 0 && (
              <Badge variant="secondary" className="text-amber-700 bg-amber-100">
                No shifts configured for this terminal yet
              </Badge>
            )}
          </div>

          {/* Roster table */}
          <RosterTable
            entries={entries}
            shifts={terminalShifts}
            workDate={workDate}
          />
        </>
      )}
    </div>
  );
}
