"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, Download } from "lucide-react";
import { setDayStatus } from "./actions";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PayrollEntry {
  workerId: string;
  employeeCode: string;
  fullName: string;
  deptName: string;
  terminalId: string;
  departmentId: string;
  dailyRate: number;
  present: boolean;
  checkoutMissing: boolean;
  dayStatus: "full" | "half";
  amount: number;
}

interface Terminal {
  id: string;
  name: string;
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${day} ${months[parseInt(month, 10) - 1]} ${year}`;
}

function fmtPKR(n: number): string {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

function downloadCSV(entries: PayrollEntry[], workDate: string, terminalName: string) {
  const headers = ["Code", "Name", "Department", "Daily Rate", "Status", "Amount Payable"];

  const dataRows = entries.map((e) => [
    e.employeeCode,
    e.fullName,
    e.deptName,
    e.dailyRate,
    e.present ? (e.dayStatus === "half" ? "Half" : "Full") : "Absent",
    e.amount,
  ]);

  const totalPayable = entries.reduce((sum, e) => sum + e.amount, 0);
  const totalsRow = ["TOTAL", "", "", "", "", totalPayable];

  const metaRow = [`Payroll: ${formatDateDisplay(workDate)}`, `Terminal: ${terminalName}`];

  const allRows = [metaRow, [], headers, ...dataRows, [], totalsRow];

  const csv = allRows
    .map((row) =>
      row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll-${workDate}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Half-day toggle ──────────────────────────────────────────────────────────

function HalfDayToggle({ entry, workDate }: { entry: PayrollEntry; workDate: string }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      try {
        await setDayStatus(entry.workerId, workDate, checked ? "half" : "full");
      } catch (err) {
        toast({
          title: "Error",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    });
  }

  return (
    <div className="flex items-center gap-2 justify-center">
      {pending && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      <Switch
        checked={entry.dayStatus === "half"}
        onCheckedChange={handleToggle}
        disabled={!entry.present || pending}
      />
      <span className="text-xs text-muted-foreground w-8">
        {entry.dayStatus === "half" ? "Half" : "Full"}
      </span>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function PayrollClient({
  workDate,
  terminalId,
  visibleTerminals,
  entries,
}: {
  workDate: string;
  terminalId: string;
  visibleTerminals: Terminal[];
  entries: PayrollEntry[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const isToday = workDate === today;

  function go(date: string, tid?: string) {
    const t = tid ?? terminalId;
    router.push(`/dashboard/payroll?date=${date}&terminal=${t}`);
  }

  const total = entries.length;
  const present = entries.filter((e) => e.present).length;
  const absent = entries.filter((e) => !e.present).length;
  const halfDays = entries.filter((e) => e.present && e.dayStatus === "half").length;
  const totalPayable = entries.reduce((sum, e) => sum + e.amount, 0);
  const missingCheckoutCount = entries.filter((e) => e.checkoutMissing).length;

  const activeTerminal = visibleTerminals.find((t) => t.id === terminalId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Payroll</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Wages payable for daily-rate workers on a given date
          </p>
        </div>

        {/* Date navigator */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => go(addDays(workDate, -1))}
            title="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-white min-w-36 justify-center">
            <input
              type="date"
              value={workDate}
              onChange={(e) => e.target.value && go(e.target.value)}
              className="text-sm font-medium bg-transparent outline-none cursor-pointer"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => go(addDays(workDate, 1))}
            title="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>

          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => go(today)}>
              Today
            </Button>
          )}
          {isToday && (
            <Badge variant="secondary" className="bg-green-100 text-green-700">
              Today
            </Badge>
          )}

          <span className="text-sm text-muted-foreground ml-1 hidden sm:block">
            {formatDateDisplay(workDate)}
          </span>
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
                href={`/dashboard/payroll?date=${workDate}&terminal=${t.id}`}
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

          {/* Summary bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <span>
                <span className="font-semibold text-foreground">{total}</span>{" "}
                <span className="text-muted-foreground">daily workers</span>
              </span>
              <span>
                <span className="font-semibold text-green-600">{present}</span>{" "}
                <span className="text-muted-foreground">present</span>
              </span>
              <span>
                <span className="font-semibold text-red-600">{absent}</span>{" "}
                <span className="text-muted-foreground">absent</span>
              </span>
              {halfDays > 0 && (
                <span>
                  <span className="font-semibold text-amber-600">{halfDays}</span>{" "}
                  <span className="text-muted-foreground">half-days</span>
                </span>
              )}
              {missingCheckoutCount > 0 && (
                <span className="flex items-center gap-1 text-orange-600">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="font-semibold">{missingCheckoutCount}</span> missing checkout
                </span>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => downloadCSV(entries, workDate, activeTerminal?.name ?? "")}
              disabled={entries.length === 0}
            >
              <Download className="w-4 h-4" />
              Download CSV
            </Button>
          </div>

          {/* Total payable, big and clear */}
          <div className="border rounded-lg bg-white p-5 flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              Total Payable
            </span>
            <span className="text-3xl font-bold text-primary">
              {fmtPKR(totalPayable)}
            </span>
          </div>

          {/* Table */}
          <div className="border rounded-lg bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Dept</TableHead>
                  <TableHead className="text-right">Daily Rate</TableHead>
                  <TableHead className="text-center">Present?</TableHead>
                  <TableHead className="text-center">Day Status</TableHead>
                  <TableHead className="text-right">Amount Payable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      No daily-pay workers found for this terminal.
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry) => (
                    <TableRow
                      key={entry.workerId}
                      className={
                        entry.checkoutMissing
                          ? "bg-orange-50/50"
                          : !entry.present
                          ? "bg-red-50/30"
                          : undefined
                      }
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.employeeCode}
                      </TableCell>
                      <TableCell className="font-medium">{entry.fullName}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {entry.deptName}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {fmtPKR(entry.dailyRate)}
                      </TableCell>
                      <TableCell className="text-center">
                        {entry.present ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-700">
                            Yes
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-red-100 text-red-700">
                            No
                          </Badge>
                        )}
                        {entry.checkoutMissing && (
                          <p className="flex items-center gap-1 justify-center text-xs text-orange-600 mt-1">
                            <AlertTriangle className="w-3 h-3" />
                            missing checkout
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {entry.present ? (
                          <HalfDayToggle entry={entry} workDate={workDate} />
                        ) : (
                          <Badge variant="secondary" className="bg-red-100 text-red-700">
                            Absent
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtPKR(entry.amount)}
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
