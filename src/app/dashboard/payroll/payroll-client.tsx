"use client";

import { useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle, Download } from "lucide-react";
import { setDayStatus } from "./actions";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DayStatus = "full" | "half" | "double" | "absent";

export interface PayrollEntry {
  workerId: string;
  employeeCode: string;
  fullName: string;
  deptName: string;
  terminalId: string;
  departmentId: string;
  dailyRate: number;
  shiftsWorked: number;
  checkoutMissing: boolean;
  status: DayStatus;
  amount: number;
}

interface Terminal {
  id: string;
  name: string;
}

const STATUS_MULTIPLIER: Record<DayStatus, number> = {
  absent: 0,
  half: 0.5,
  full: 1,
  double: 2,
};

const STATUS_LABEL: Record<DayStatus, string> = {
  full: "Full",
  half: "Half",
  double: "Double",
  absent: "Absent",
};

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

function formatCutoff12h(cutoffTime: string): string {
  const [h, m] = cutoffTime.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtPKR(n: number): string {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

function downloadCSV(
  entries: PayrollEntry[],
  closingDate: string,
  cutoffTime: string,
  terminalName: string
) {
  const headers = ["Code", "Name", "Department", "Daily Rate", "Shifts", "Status", "Amount Payable"];

  const dataRows = entries.map((e) => [
    e.employeeCode,
    e.fullName,
    e.deptName,
    e.dailyRate,
    e.shiftsWorked,
    STATUS_LABEL[e.status],
    e.amount,
  ]);

  const totalPayable = entries.reduce((sum, e) => sum + e.amount, 0);
  const totalsRow = ["TOTAL", "", "", "", "", "", totalPayable];

  const windowText = `covers ${formatDateDisplay(addDays(closingDate, -1))} ${formatCutoff12h(cutoffTime)} to ${formatDateDisplay(closingDate)} ${formatCutoff12h(cutoffTime)}`;
  const metaRow = [`Payroll closing: ${formatDateDisplay(closingDate)}`, windowText, `Terminal: ${terminalName}`];

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
  a.download = `payroll-closing-${closingDate}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Status dropdown ──────────────────────────────────────────────────────────

function StatusSelect({ entry, closingDate }: { entry: PayrollEntry; closingDate: string }) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(async () => {
      try {
        await setDayStatus(entry.workerId, closingDate, value as DayStatus);
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
      <Select value={entry.status} onValueChange={handleChange} disabled={pending}>
        <SelectTrigger className="h-8 w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="full">Full</SelectItem>
          <SelectItem value="half">Half</SelectItem>
          <SelectItem value="double">Double</SelectItem>
          <SelectItem value="absent">Absent</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function PayrollClient({
  closingDate,
  cutoffTime,
  terminalId,
  visibleTerminals,
  entries,
}: {
  closingDate: string;
  cutoffTime: string;
  terminalId: string;
  visibleTerminals: Terminal[];
  entries: PayrollEntry[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const isToday = closingDate === today;

  function go(date: string, tid?: string) {
    const t = tid ?? terminalId;
    router.push(`/dashboard/payroll?date=${date}&terminal=${t}`);
  }

  const total = entries.length;
  const absent = entries.filter((e) => e.status === "absent").length;
  const present = total - absent;
  const totalShiftsPaid = entries.reduce((sum, e) => sum + STATUS_MULTIPLIER[e.status], 0);
  const totalPayable = entries.reduce((sum, e) => sum + e.amount, 0);
  const missingCheckoutCount = entries.filter((e) => e.checkoutMissing).length;

  const activeTerminal = visibleTerminals.find((t) => t.id === terminalId);
  const prevDayLabel = formatDateDisplay(addDays(closingDate, -1));
  const cutoffLabel = formatCutoff12h(cutoffTime);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Daily Payroll</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Closing {formatDateDisplay(closingDate)} · covers {prevDayLabel} {cutoffLabel} → {formatDateDisplay(closingDate)} {cutoffLabel}
          </p>
        </div>

        {/* Date navigator */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => go(addDays(closingDate, -1))}
            title="Previous closing"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-white min-w-36 justify-center">
            <input
              type="date"
              value={closingDate}
              onChange={(e) => e.target.value && go(e.target.value)}
              className="text-sm font-medium bg-transparent outline-none cursor-pointer"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => go(addDays(closingDate, 1))}
            title="Next closing"
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
                href={`/dashboard/payroll?date=${closingDate}&terminal=${t.id}`}
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
              <span>
                <span className="font-semibold text-foreground">{totalShiftsPaid}</span>{" "}
                <span className="text-muted-foreground">total shifts paid</span>
              </span>
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
              onClick={() => downloadCSV(entries, closingDate, cutoffTime, activeTerminal?.name ?? "")}
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
                  <TableHead className="text-center">Shifts</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
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
                          : entry.status === "absent"
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
                      <TableCell className="text-center font-semibold">
                        {entry.shiftsWorked}
                      </TableCell>
                      <TableCell className="text-center">
                        <StatusSelect entry={entry} closingDate={closingDate} />
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {fmtPKR(entry.amount)}
                      </TableCell>
                      <TableCell>
                        {entry.checkoutMissing && (
                          <span className="flex items-center gap-1 text-xs text-orange-600">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            missing checkout
                          </span>
                        )}
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
