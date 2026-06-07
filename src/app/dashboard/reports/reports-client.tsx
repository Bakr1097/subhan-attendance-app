"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WorkerSummary {
  workerId: string;
  employeeCode: string;
  fullName: string;
  deptName: string;
  present: number;
  absent: number;
  leave: number;
  noRecord: number;
  totalWorkedMinutes: number;
  lateCount: number;
}

interface Terminal { id: string; name: string }
interface Dept { id: string; name: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtHours(minutes: number): string {
  if (minutes === 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatMonth(ym: string): string {
  const [y, mo] = ym.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
}

function prevMonth(ym: string): string {
  const [y, mo] = ym.split("-").map(Number);
  return mo === 1
    ? `${y - 1}-12`
    : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

function nextMonth(ym: string): string {
  const [y, mo] = ym.split("-").map(Number);
  return mo === 12
    ? `${y + 1}-01`
    : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function downloadCSV(
  summaries: WorkerSummary[],
  month: string,
  daysElapsed: number
) {
  const headers = [
    "Employee Code",
    "Name",
    "Department",
    "Present",
    "Absent",
    "Leave",
    "No Record",
    "Total Hours",
    "Late Arrivals",
  ];

  const dataRows = summaries.map((s) => [
    s.employeeCode,
    s.fullName,
    s.deptName,
    s.present,
    s.absent,
    s.leave,
    s.noRecord,
    fmtHours(s.totalWorkedMinutes),
    s.lateCount,
  ]);

  const totals = summaries.reduce(
    (acc, s) => ({
      present: acc.present + s.present,
      absent: acc.absent + s.absent,
      leave: acc.leave + s.leave,
      noRecord: acc.noRecord + s.noRecord,
      totalWorkedMinutes: acc.totalWorkedMinutes + s.totalWorkedMinutes,
      lateCount: acc.lateCount + s.lateCount,
    }),
    {
      present: 0,
      absent: 0,
      leave: 0,
      noRecord: 0,
      totalWorkedMinutes: 0,
      lateCount: 0,
    }
  );

  const totalsRow = [
    "TOTALS",
    `${summaries.length} workers`,
    "",
    totals.present,
    totals.absent,
    totals.leave,
    totals.noRecord,
    fmtHours(totals.totalWorkedMinutes),
    totals.lateCount,
  ];

  const metaRow = [`Report: ${formatMonth(month)}`, `Days elapsed: ${daysElapsed}`];

  const allRows = [metaRow, [], headers, ...dataRows, [], totalsRow];

  const csv = allRows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${month}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ReportsClient({
  month,
  terminalId,
  deptId,
  visibleTerminals,
  terminalDepts,
  summaries,
  daysElapsed,
}: {
  month: string;
  terminalId: string;
  deptId: string;
  visibleTerminals: Terminal[];
  terminalDepts: Dept[];
  summaries: WorkerSummary[];
  daysElapsed: number;
}) {
  const router = useRouter();
  const currentMonth = thisMonth();
  const isCurrentMonth = month === currentMonth;

  function goMonth(ym: string) {
    const params = new URLSearchParams({ month: ym, terminal: terminalId });
    if (deptId) params.set("dept", deptId);
    router.push(`/dashboard/reports?${params.toString()}`);
  }

  const totals = summaries.reduce(
    (acc, s) => ({
      present: acc.present + s.present,
      absent: acc.absent + s.absent,
      leave: acc.leave + s.leave,
      noRecord: acc.noRecord + s.noRecord,
      totalWorkedMinutes: acc.totalWorkedMinutes + s.totalWorkedMinutes,
      lateCount: acc.lateCount + s.lateCount,
    }),
    {
      present: 0,
      absent: 0,
      leave: 0,
      noRecord: 0,
      totalWorkedMinutes: 0,
      lateCount: 0,
    }
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Monthly attendance summary
            {daysElapsed > 0 && (
              <> — {daysElapsed} day{daysElapsed !== 1 ? "s" : ""} elapsed</>
            )}
          </p>
        </div>

        {/* Month navigator */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(prevMonth(month))}
            title="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <div className="px-4 py-1.5 border rounded-md bg-white text-sm font-semibold min-w-40 text-center">
            {formatMonth(month)}
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(nextMonth(month))}
            title="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>

          {!isCurrentMonth && (
            <Button variant="ghost" size="sm" onClick={() => goMonth(currentMonth)}>
              This month
            </Button>
          )}
          {isCurrentMonth && (
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              Current
            </Badge>
          )}
        </div>
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
                href={`/dashboard/reports?month=${month}&terminal=${t.id}`}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  t.id === terminalId
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-muted-foreground border-border hover:bg-slate-50"
                }`}
              >
                {t.name}
              </a>
            ))}
          </div>

          {/* Department filter + Export */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground shrink-0">
                Department:
              </label>
              <select
                value={deptId}
                onChange={(e) => {
                  const params = new URLSearchParams({
                    month,
                    terminal: terminalId,
                  });
                  if (e.target.value) params.set("dept", e.target.value);
                  router.push(`/dashboard/reports?${params.toString()}`);
                }}
                className="text-sm border rounded-md px-2 py-1.5 bg-white outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All departments</option>
                {terminalDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => downloadCSV(summaries, month, daysElapsed)}
              disabled={summaries.length === 0}
            >
              <Download className="w-4 h-4" />
              Download CSV
            </Button>
          </div>

          {/* Summary table */}
          <div className="border rounded-lg bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Department</TableHead>
                  <TableHead className="text-center">Present</TableHead>
                  <TableHead className="text-center">Absent</TableHead>
                  <TableHead className="text-center">Leave</TableHead>
                  <TableHead className="text-center hidden sm:table-cell">
                    No Record
                  </TableHead>
                  <TableHead className="text-right">Total Hours</TableHead>
                  <TableHead className="text-center hidden lg:table-cell">
                    Late
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-muted-foreground py-10"
                    >
                      No workers found for this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {summaries.map((s) => (
                      <TableRow key={s.workerId}>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {s.employeeCode}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/dashboard/reports/${s.workerId}?month=${month}&terminal=${terminalId}`}
                            className="font-medium hover:underline text-primary"
                          >
                            {s.fullName}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {s.deptName}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="font-semibold text-green-700">
                            {s.present}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={
                              s.absent > 0
                                ? "font-semibold text-red-600"
                                : "text-muted-foreground"
                            }
                          >
                            {s.absent}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span
                            className={
                              s.leave > 0
                                ? "font-semibold text-blue-600"
                                : "text-muted-foreground"
                            }
                          >
                            {s.leave}
                          </span>
                        </TableCell>
                        <TableCell className="text-center hidden sm:table-cell">
                          <span
                            className={
                              s.noRecord > 0
                                ? "text-amber-600"
                                : "text-muted-foreground"
                            }
                          >
                            {s.noRecord}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {fmtHours(s.totalWorkedMinutes)}
                        </TableCell>
                        <TableCell className="text-center hidden lg:table-cell">
                          <span
                            className={
                              s.lateCount > 0
                                ? "font-semibold text-amber-600"
                                : "text-muted-foreground"
                            }
                          >
                            {s.lateCount}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* Totals row */}
                    <TableRow className="bg-slate-50 border-t-2 font-semibold">
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        —
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {summaries.length} worker
                        {summaries.length !== 1 ? "s" : ""}
                      </TableCell>
                      <TableCell className="hidden md:table-cell" />
                      <TableCell className="text-center text-green-700">
                        {totals.present}
                      </TableCell>
                      <TableCell className="text-center text-red-600">
                        {totals.absent}
                      </TableCell>
                      <TableCell className="text-center text-blue-600">
                        {totals.leave}
                      </TableCell>
                      <TableCell className="text-center hidden sm:table-cell text-amber-600">
                        {totals.noRecord}
                      </TableCell>
                      <TableCell className="text-right">
                        {fmtHours(totals.totalWorkedMinutes)}
                      </TableCell>
                      <TableCell className="text-center hidden lg:table-cell text-amber-600">
                        {totals.lateCount}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
