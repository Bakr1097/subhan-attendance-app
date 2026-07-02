import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  workers,
  departments,
  shifts,
  terminals,
  supervisorScopes,
} from "@/db/schema";
import { eq, and, or, ilike } from "drizzle-orm";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { WorkerForm, WorkerStatusToggle } from "./worker-form";
import { Search } from "lucide-react";

export default async function WorkersPage({
  searchParams,
}: {
  searchParams: { terminal?: string; department?: string; search?: string };
}) {
  const session = await auth();
  if (!session) redirect("/login");

  // ── Load all reference data ─────────────────────────────────────────────────
  const allTerminals = await db
    .select()
    .from(terminals)
    .orderBy(terminals.createdAt);

  const allDepts = await db
    .select()
    .from(departments)
    .orderBy(departments.name);

  const allShifts = await db.select().from(shifts).orderBy(shifts.name);

  // ── Determine allowed scope ─────────────────────────────────────────────────
  let allowedTerminalIds: string[];
  let allowedDeptIds: string[];

  if (session.user.role === "admin") {
    allowedTerminalIds = allTerminals.map((t) => t.id);
    allowedDeptIds = allDepts.map((d) => d.id);
  } else {
    const scopes = await db
      .select()
      .from(supervisorScopes)
      .where(eq(supervisorScopes.userId, session.user.id));

    allowedTerminalIds = Array.from(new Set(scopes.map((s) => s.terminalId)));

    const scopedDeptIds: string[] = [];
    for (const scope of scopes) {
      if (scope.departmentId) {
        scopedDeptIds.push(scope.departmentId);
      } else {
        // null dept_id = whole terminal
        allDepts
          .filter((d) => d.terminalId === scope.terminalId)
          .forEach((d) => scopedDeptIds.push(d.id));
      }
    }
    allowedDeptIds = Array.from(new Set(scopedDeptIds));
  }

  const visibleTerminals = allTerminals.filter((t) =>
    allowedTerminalIds.includes(t.id)
  );
  const visibleDepts = allDepts.filter((d) =>
    allowedDeptIds.includes(d.id)
  );
  const visibleShifts = allShifts.filter((s) =>
    allowedTerminalIds.includes(s.terminalId)
  );

  // ── Active filters from URL ─────────────────────────────────────────────────
  const activeTerminalId =
    searchParams.terminal ?? visibleTerminals[0]?.id ?? "";
  const activeDeptId = searchParams.department ?? "";
  const search = searchParams.search ?? "";

  // ── Build query conditions ──────────────────────────────────────────────────
  const conditions = [eq(workers.terminalId, activeTerminalId)];

  if (activeDeptId) {
    conditions.push(eq(workers.departmentId, activeDeptId));
  }
  if (search) {
    conditions.push(
      or(
        ilike(workers.fullName, `%${search}%`),
        ilike(workers.employeeCode, `%${search}%`)
      )!
    );
  }

  const rows = await db
    .select({
      id: workers.id,
      employeeCode: workers.employeeCode,
      fullName: workers.fullName,
      status: workers.status,
      terminalId: workers.terminalId,
      departmentId: workers.departmentId,
      defaultShiftId: workers.defaultShiftId,
      cnic: workers.cnic,
      phone: workers.phone,
      referencePhotoUrl: workers.referencePhotoUrl,
      deviceUserId: workers.deviceUserId,
      deptName: departments.name,
      shiftName: shifts.name,
    })
    .from(workers)
    .leftJoin(departments, eq(workers.departmentId, departments.id))
    .leftJoin(shifts, eq(workers.defaultShiftId, shifts.id))
    .where(activeTerminalId ? and(...conditions) : undefined)
    .orderBy(workers.employeeCode);

  const activeTerminal = visibleTerminals.find(
    (t) => t.id === activeTerminalId
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workers</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage daily-wage workers and their kiosk PINs
          </p>
        </div>
        {visibleTerminals.length > 0 && (
          <WorkerForm
            terminals={visibleTerminals}
            departments={visibleDepts}
            allShifts={visibleShifts}
            defaultTerminalId={activeTerminalId}
          />
        )}
      </div>

      {visibleTerminals.length === 0 ? (
        <div className="border rounded-lg bg-white p-10 text-center text-muted-foreground">
          No terminals available. Add a terminal and departments first.
        </div>
      ) : (
        <>
          {/* Terminal tabs */}
          <div className="flex gap-2 flex-wrap">
            {visibleTerminals.map((t) => (
              <a
                key={t.id}
                href={`/dashboard/workers?terminal=${t.id}`}
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

          {/* Search + department filter */}
          <div className="flex gap-3 flex-wrap">
            <form className="relative flex-1 min-w-48 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                name="search"
                type="search"
                defaultValue={search}
                placeholder="Search by name or code…"
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {/* Preserve other params */}
              {activeTerminalId && (
                <input type="hidden" name="terminal" value={activeTerminalId} />
              )}
              {activeDeptId && (
                <input
                  type="hidden"
                  name="department"
                  value={activeDeptId}
                />
              )}
            </form>

            {/* Department filter links */}
            <div className="flex gap-1.5 flex-wrap items-center">
              <a
                href={`/dashboard/workers?terminal=${activeTerminalId}${search ? `&search=${search}` : ""}`}
                className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                  !activeDeptId
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-muted-foreground border-border hover:bg-slate-50"
                }`}
              >
                All depts
              </a>
              {visibleDepts
                .filter((d) => d.terminalId === activeTerminalId)
                .map((d) => (
                  <a
                    key={d.id}
                    href={`/dashboard/workers?terminal=${activeTerminalId}&department=${d.id}${search ? `&search=${search}` : ""}`}
                    className={`px-2.5 py-1.5 text-xs rounded border transition-colors ${
                      d.id === activeDeptId
                        ? "bg-slate-800 text-white border-slate-800"
                        : "bg-white text-muted-foreground border-border hover:bg-slate-50"
                    }`}
                  >
                    {d.name}
                  </a>
                ))}
            </div>
          </div>

          {/* Workers table */}
          <div className="border rounded-lg bg-white overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-2">
              <span className="text-sm font-medium">
                {activeTerminal?.name}
              </span>
              <Badge variant="secondary">{rows.length} workers</Badge>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Code</TableHead>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Default Shift</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-10"
                    >
                      {search
                        ? `No workers matching "${search}".`
                        : "No workers yet. Add your first worker above."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-mono text-sm font-medium">
                        {w.employeeCode}
                      </TableCell>
                      <TableCell className="font-medium">
                        {w.fullName}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {w.deptName ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {w.shiftName ?? (
                          <span className="italic">No default</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            w.status === "active" ? "default" : "secondary"
                          }
                          className={
                            w.status === "active"
                              ? "bg-green-100 text-green-800 hover:bg-green-100"
                              : ""
                          }
                        >
                          {w.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <WorkerForm
                          terminals={visibleTerminals}
                          departments={visibleDepts}
                          allShifts={visibleShifts}
                          worker={w}
                          defaultTerminalId={w.terminalId}
                        />
                        <WorkerStatusToggle
                          id={w.id}
                          status={w.status as "active" | "inactive"}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
