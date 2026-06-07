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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle } from "lucide-react";
import {
  correctAttendance,
  markAbsent,
  markLeave,
  type CorrectionPayload,
} from "./actions";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AttendanceEntry {
  workerId: string;
  employeeCode: string;
  fullName: string;
  deptName: string;
  terminalId: string;
  departmentId: string;
  resolvedShiftId: string | null;
  shiftName: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  recordId: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: "present" | "absent" | "leave" | null;
  leaveReason: string | null;
  isLate: boolean;
  lateMinutes: number;
  leftEarly: boolean;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number | null;
  checkoutMissing: boolean;
}

interface Terminal {
  id: string;
  name: string;
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

function isoToTimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function timeInputToISO(workDate: string, hhmm: string): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, day] = workDate.split("-").map(Number);
  return new Date(y, mo - 1, day, h, m, 0, 0).toISOString();
}

function fmtWorked(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

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

// ─── Edit dialog ──────────────────────────────────────────────────────────────

function EditDialog({
  entry,
  workDate,
  open,
  onClose,
}: {
  entry: AttendanceEntry;
  workDate: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [checkIn, setCheckIn] = useState(isoToTimeInput(entry.checkInAt));
  const [checkOut, setCheckOut] = useState(isoToTimeInput(entry.checkOutAt));

  function handleSave() {
    const payload: CorrectionPayload = {
      workerId: entry.workerId,
      workDate,
      terminalId: entry.terminalId,
      departmentId: entry.departmentId,
      checkInISO: checkIn ? timeInputToISO(workDate, checkIn) : null,
      checkOutISO: checkOut ? timeInputToISO(workDate, checkOut) : null,
    };

    startTransition(async () => {
      try {
        await correctAttendance(payload);
        toast({ title: "Attendance updated" });
        onClose();
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Attendance</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 pb-1">
          <p className="font-semibold">{entry.fullName}</p>
          <p className="text-sm text-muted-foreground">
            {entry.employeeCode} · {entry.deptName}
            {entry.shiftName && ` · ${entry.shiftName}`}
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="att-in">Check-in time</Label>
            <Input
              id="att-in"
              type="time"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-out">
              Check-out time{" "}
              <span className="text-muted-foreground font-normal">(leave blank if still out)</span>
            </Label>
            <Input
              id="att-out"
              type="time"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            All late / early-leave / overtime flags will be recalculated automatically on save.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending || (!checkIn && !checkOut)}>
            {pending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save & Recalculate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Leave dialog ─────────────────────────────────────────────────────────────

function LeaveDialog({
  entry,
  workDate,
  open,
  onClose,
}: {
  entry: AttendanceEntry;
  workDate: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  function handleConfirm() {
    startTransition(async () => {
      try {
        await markLeave(
          entry.workerId,
          workDate,
          entry.terminalId,
          entry.departmentId,
          reason
        );
        toast({ title: `${entry.fullName} marked as on leave` });
        onClose();
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
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark as Leave</DialogTitle>
        </DialogHeader>

        <div className="space-y-1 pb-1">
          <p className="font-semibold">{entry.fullName}</p>
          <p className="text-sm text-muted-foreground">{entry.employeeCode} · {entry.deptName}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="leave-reason">
            Reason{" "}
            <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Input
            id="leave-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Annual leave, Sick leave…"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={pending}>
            {pending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Mark Leave"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Row actions ──────────────────────────────────────────────────────────────

function RowActions({
  entry,
  workDate,
}: {
  entry: AttendanceEntry;
  workDate: string;
}) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [absentPending, startAbsent] = useTransition();

  function handleAbsent() {
    startAbsent(async () => {
      try {
        await markAbsent(
          entry.workerId,
          workDate,
          entry.terminalId,
          entry.departmentId
        );
        toast({ title: `${entry.fullName} marked as absent` });
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
    <>
      <div className="flex items-center gap-1 justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7 px-2"
          onClick={() => setEditOpen(true)}
        >
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={handleAbsent}
          disabled={absentPending}
        >
          {absentPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Absent"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => setLeaveOpen(true)}
        >
          Leave
        </Button>
      </div>

      {editOpen && (
        <EditDialog
          entry={entry}
          workDate={workDate}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
      {leaveOpen && (
        <LeaveDialog
          entry={entry}
          workDate={workDate}
          open={leaveOpen}
          onClose={() => setLeaveOpen(false)}
        />
      )}
    </>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AttendanceEntry["status"] }) {
  if (!status) {
    return (
      <Badge variant="secondary" className="text-slate-400">
        No record
      </Badge>
    );
  }
  if (status === "present") {
    return (
      <Badge variant="secondary" className="bg-green-100 text-green-700">
        Present
      </Badge>
    );
  }
  if (status === "absent") {
    return (
      <Badge variant="secondary" className="bg-red-100 text-red-700">
        Absent
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-blue-100 text-blue-700">
      Leave
    </Badge>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function AttendanceClient({
  workDate,
  terminalId,
  visibleTerminals,
  entries,
}: {
  workDate: string;
  terminalId: string;
  visibleTerminals: Terminal[];
  entries: AttendanceEntry[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const isToday = workDate === today;

  function go(date: string, tid?: string) {
    const t = tid ?? terminalId;
    router.push(`/dashboard/attendance?date=${date}&terminal=${t}`);
  }

  // ── Summary counts ──────────────────────────────────────────────────────────
  const total = entries.length;
  const present = entries.filter((e) => e.status === "present").length;
  const absent = entries.filter((e) => e.status === "absent").length;
  const onLeave = entries.filter((e) => e.status === "leave").length;
  const noRecord = entries.filter((e) => !e.status).length;
  const late = entries.filter((e) => e.isLate).length;
  const missingCheckout = entries.filter((e) => e.checkoutMissing).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
          <p className="text-muted-foreground text-sm mt-1">
            View and correct attendance records for any date
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
                href={`/dashboard/attendance?date=${workDate}&terminal=${t.id}`}
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span>
              <span className="font-semibold text-foreground">{total}</span>{" "}
              <span className="text-muted-foreground">total</span>
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
              <span className="font-semibold text-blue-600">{onLeave}</span>{" "}
              <span className="text-muted-foreground">leave</span>
            </span>
            {noRecord > 0 && (
              <span>
                <span className="font-semibold text-slate-500">{noRecord}</span>{" "}
                <span className="text-muted-foreground">no record</span>
              </span>
            )}
            {late > 0 && (
              <span className="text-amber-700">
                <span className="font-semibold">{late}</span> late
              </span>
            )}
            {missingCheckout > 0 && (
              <span className="flex items-center gap-1 text-orange-600">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="font-semibold">{missingCheckout}</span> missing checkout
              </span>
            )}
          </div>

          {/* Table */}
          <div className="border rounded-lg bg-white overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Dept</TableHead>
                  <TableHead className="hidden lg:table-cell">Shift</TableHead>
                  <TableHead>Check-in</TableHead>
                  <TableHead>Check-out</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Worked</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-muted-foreground py-10"
                    >
                      No active workers found for this terminal.
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
                          : entry.status === "leave"
                          ? "bg-blue-50/30"
                          : undefined
                      }
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.employeeCode}
                      </TableCell>
                      <TableCell className="font-medium">
                        {entry.fullName}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {entry.deptName}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                        {entry.shiftName ? (
                          <span>
                            {entry.shiftName}
                            {entry.shiftStart && (
                              <span className="text-xs text-slate-400 ml-1">
                                {entry.shiftStart}–{entry.shiftEnd}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>

                      {/* Check-in */}
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className={entry.checkInAt ? "text-sm" : "text-muted-foreground text-sm"}>
                            {fmtTime(entry.checkInAt)}
                          </span>
                          {entry.isLate && (
                            <span className="text-xs text-amber-600">
                              +{entry.lateMinutes}m late
                            </span>
                          )}
                        </div>
                      </TableCell>

                      {/* Check-out */}
                      <TableCell>
                        {entry.checkoutMissing ? (
                          <span className="flex items-center gap-1 text-orange-600 text-sm">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Missing
                          </span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span className={entry.checkOutAt ? "text-sm" : "text-muted-foreground text-sm"}>
                              {fmtTime(entry.checkOutAt)}
                            </span>
                            {entry.leftEarly && (
                              <span className="text-xs text-amber-600">
                                -{entry.earlyLeaveMinutes}m early
                              </span>
                            )}
                            {entry.overtimeMinutes > 0 && (
                              <span className="text-xs text-emerald-600">
                                +{entry.overtimeMinutes}m OT
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <StatusBadge status={entry.status} />
                        {entry.leaveReason && (
                          <p className="text-xs text-muted-foreground mt-0.5 max-w-[120px] truncate">
                            {entry.leaveReason}
                          </p>
                        )}
                      </TableCell>

                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {fmtWorked(entry.workedMinutes)}
                      </TableCell>

                      <TableCell>
                        <RowActions entry={entry} workDate={workDate} />
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
