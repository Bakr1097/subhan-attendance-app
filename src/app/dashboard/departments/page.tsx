import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { terminals, departments } from "@/db/schema";
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
import { DepartmentDialog, DeleteDepartmentButton } from "./department-dialog";

export default async function DepartmentsPage({
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
        .from(departments)
        .where(eq(departments.terminalId, activeTerminalId))
        .orderBy(departments.createdAt)
    : [];

  const activeTerminal = allTerminals.find((t) => t.id === activeTerminalId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Departments</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage departments within each terminal
          </p>
        </div>
        {allTerminals.length > 0 && (
          <DepartmentDialog
            terminals={allTerminals}
            defaultTerminalId={activeTerminalId}
          />
        )}
      </div>

      {allTerminals.length === 0 ? (
        <div className="border rounded-lg bg-white p-10 text-center text-muted-foreground">
          No terminals found. Add a terminal first before creating departments.
        </div>
      ) : (
        <>
          {/* Terminal filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {allTerminals.map((t) => (
              <a
                key={t.id}
                href={`/dashboard/departments?terminal=${t.id}`}
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
              <Badge variant="secondary">{rows.length} departments</Badge>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-muted-foreground py-10"
                    >
                      No departments yet for this terminal.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {d.createdAt
                          ? new Date(d.createdAt).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DepartmentDialog
                          terminals={allTerminals}
                          department={d}
                          defaultTerminalId={d.terminalId}
                        />
                        <DeleteDepartmentButton department={d} />
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
