import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { terminals, shifts } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ShiftDialog, DeleteShiftButton } from "./shift-dialog";

function fmt(t: string | null): string {
  if (!t) return "—";
  return t.slice(0, 5);
}

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: { terminal?: string };
}) {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/dashboard");

  const allTerminals = await db
    .select()
    .from(terminals)
    .orderBy(terminals.createdAt);

  const activeTerminalId = searchParams.terminal ?? allTerminals[0]?.id;

  const rows = activeTerminalId
    ? await db
        .select()
        .from(shifts)
        .where(eq(shifts.terminalId, activeTerminalId))
        .orderBy(shifts.createdAt)
    : [];

  const activeTerminal = allTerminals.find((t) => t.id === activeTerminalId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shifts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Define shift schedules for each terminal
          </p>
        </div>
        {allTerminals.length > 0 && (
          <ShiftDialog
            terminals={allTerminals}
            defaultTerminalId={activeTerminalId}
          />
        )}
      </div>

      {allTerminals.length === 0 ? (
        <div className="border rounded-lg bg-white p-10 text-center text-muted-foreground">
          No terminals found. Add a terminal first before creating shifts.
        </div>
      ) : (
        <>
          {/* Terminal filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {allTerminals.map((t) => (
              <a
                key={t.id}
                href={`/dashboard/shifts?terminal=${t.id}`}
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

          <div className="border rounded-lg bg-white overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-2">
              <span className="text-sm font-medium">
                {activeTerminal?.name}
              </span>
              <Badge variant="secondary">{rows.length} shifts</Badge>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Hours</TableHead>
                  <TableHead>Late grace</TableHead>
                  <TableHead>Early-leave grace</TableHead>
                  <TableHead>Night shift</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-10"
                    >
                      No shifts yet for this terminal. Add your first shift
                      above.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {fmt(s.startTime)} → {fmt(s.endTime)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.graceMinutes} min
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.earlyLeaveGraceMinutes} min
                      </TableCell>
                      <TableCell>
                        {s.crossesMidnight ? (
                          <Badge variant="secondary">Night</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <ShiftDialog
                          terminals={allTerminals}
                          shift={s}
                          defaultTerminalId={s.terminalId}
                        />
                        <DeleteShiftButton shift={s} />
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
