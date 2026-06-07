"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface DayEntry {
  date: string;
  shiftName: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: "present" | "absent" | "leave" | null;
  workedMinutes: number | null;
  isLate: boolean;
  lateMinutes: number;
  leftEarly: boolean;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  checkoutMissing: boolean;
  leaveReason: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatDayLabel(dateStr: string): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  return `${DAY_NAMES[dt.getDay()]} ${String(d).padStart(2, "0")} ${MONTH_SHORT[mo - 1]}`;
}

function formatMonth(ym: string): string {
  const [y, mo] = ym.split("-").map(Number);
  return `${MONTH_FULL[mo - 1]} ${y}`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

function fmtWorked(minutes: number | null): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtTotal(minutes: number): string {
  if (minutes === 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function buildNotes(entry: DayEntry): string {
  const parts: string[] = [];
  if (entry.isLate) parts.push(`Late +${entry.lateMinutes}m`);
  if (entry.leftEarly) parts.push(`Early -${entry.earlyLeaveMinutes}m`);
  if (entry.overtimeMinutes > 0) parts.push(`OT +${entry.overtimeMinutes}m`);
  if (entry.checkoutMissing) parts.push("Missing checkout");
  if (entry.status === "leave" && entry.leaveReason) parts.push(entry.leaveReason);
  return parts.join(" · ");
}

function StatusBadge({ status }: { status: DayEntry["status"] }) {
  if (!status)
    return <span className="text-slate-400 text-xs">No record</span>;
  if (status === "present")
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
        Present
      </Badge>
    );
  if (status === "absent")
    return (
      <Badge variant="secondary" className="bg-red-100 text-red-700 text-xs">
        Absent
      </Badge>
    );
  return (
    <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-xs">
      Leave
    </Badge>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function DetailClient({
  worker,
  month,
  terminalId,
  days,
  stats,
}: {
  worker: {
    id: string;
    fullName: string;
    employeeCode: string;
    deptName: string;
  };
  month: string;
  terminalId: string;
  days: DayEntry[];
  stats: {
    present: number;
    absent: number;
    leave: number;
    totalWorkedMinutes: number;
    lateCount: number;
  };
}) {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href={`/dashboard/reports?month=${month}&terminal=${terminalId}`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to {formatMonth(month)} summary
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{worker.fullName}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {worker.employeeCode} · {worker.deptName} · {formatMonth(month)}
        </p>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl">
          <span className="text-2xl font-bold text-green-700">{stats.present}</span>
          <span className="text-sm text-green-600">Present</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl">
          <span className="text-2xl font-bold text-red-700">{stats.absent}</span>
          <span className="text-sm text-red-600">Absent</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
          <span className="text-2xl font-bold text-blue-700">{stats.leave}</span>
          <span className="text-sm text-blue-600">Leave</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
          <span className="text-2xl font-bold text-slate-700">
            {fmtTotal(stats.totalWorkedMinutes)}
          </span>
          <span className="text-sm text-slate-500">Worked</span>
        </div>
        {stats.lateCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
            <span className="text-2xl font-bold text-amber-700">
              {stats.lateCount}
            </span>
            <span className="text-sm text-amber-600">Late</span>
          </div>
        )}
      </div>

      {/* Day-by-day table */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Date</TableHead>
              <TableHead className="hidden sm:table-cell">Shift</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Worked</TableHead>
              <TableHead className="hidden lg:table-cell">Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => {
              const isFuture = day.date > today;
              const isToday = day.date === today;

              return (
                <TableRow
                  key={day.date}
                  className={
                    isFuture
                      ? "opacity-40"
                      : day.checkoutMissing
                      ? "bg-orange-50/50"
                      : day.status === "absent"
                      ? "bg-red-50/30"
                      : day.status === "leave"
                      ? "bg-blue-50/30"
                      : undefined
                  }
                >
                  <TableCell className="text-sm font-mono">
                    <span className={isToday ? "font-bold text-primary" : ""}>
                      {formatDayLabel(day.date)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {day.shiftName ?? (
                      <span className="text-slate-300">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmtTime(day.checkInAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmtTime(day.checkOutAt)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={day.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {fmtWorked(day.workedMinutes)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                    {buildNotes(day) || (
                      <span className="text-slate-200">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
