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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { setShiftOverride, clearShiftOverride } from "./actions";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RosterEntry {
  workerId: string;
  employeeCode: string;
  fullName: string;
  deptName: string;
  defaultShiftId: string | null;
  defaultShiftName: string | null;
  overrideShiftId: string | null;
  overrideShiftName: string | null;
}

export interface ShiftOption {
  id: string;
  name: string;
}

// ─── Date helpers (no locale-specific formatting) ────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const months = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec",
  ];
  return `${day} ${months[parseInt(month, 10) - 1]} ${year}`;
}

// ─── Date Navigator ───────────────────────────────────────────────────────────

export function DateNavigator({
  date,
  terminalId,
}: {
  date: string;
  terminalId: string;
}) {
  const router = useRouter();

  function go(d: string) {
    router.push(`/dashboard/roster?date=${d}&terminal=${terminalId}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant="outline"
        size="icon"
        onClick={() => go(addDays(date, -1))}
        title="Previous day"
      >
        <ChevronLeft className="w-4 h-4" />
      </Button>

      <div className="flex items-center gap-2 px-3 py-1.5 border rounded-md bg-white min-w-36 justify-center">
        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="text-sm font-medium bg-transparent outline-none cursor-pointer"
        />
      </div>

      <Button
        variant="outline"
        size="icon"
        onClick={() => go(addDays(date, 1))}
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

      <span className="text-sm text-muted-foreground ml-1 hidden sm:inline">
        {formatDateDisplay(date)}
      </span>
    </div>
  );
}

// ─── Shared shift-override state (used by both the desktop row and the ─────
// mobile card — each mounted instance gets its own independent state, which
// is fine since only one of the two is ever visible on a given device: the
// md breakpoint (768px) is well above any phone's width in either
// orientation, so there's no real scenario where both are live at once.

const NO_OVERRIDE = "__default__";

function useShiftOverride(entry: RosterEntry, workDate: string) {
  const { toast } = useToast();
  const [overrideId, setOverrideId] = useState(entry.overrideShiftId);
  const [pending, startTransition] = useTransition();

  const isOverridden = overrideId !== null;
  const selectValue = overrideId ?? NO_OVERRIDE;

  // Label shown in the "default" option
  const defaultLabel = entry.defaultShiftName
    ? `↩ Default: ${entry.defaultShiftName}`
    : "↩ No default shift";

  function handleChange(value: string) {
    const newOverride = value === NO_OVERRIDE ? null : value;
    const previous = overrideId;
    setOverrideId(newOverride); // optimistic

    startTransition(async () => {
      try {
        if (newOverride === null) {
          await clearShiftOverride(entry.workerId, workDate);
        } else {
          await setShiftOverride(entry.workerId, workDate, newOverride);
        }
      } catch (err) {
        setOverrideId(previous); // revert on error
        toast({
          title: "Could not save",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    });
  }

  return { overrideId, isOverridden, selectValue, pending, defaultLabel, handleChange };
}

// ─── Single roster row (desktop, md and up) ──────────────────────────────────

function RosterRow({
  entry,
  shifts,
  workDate,
}: {
  entry: RosterEntry;
  shifts: ShiftOption[];
  workDate: string;
}) {
  const { isOverridden, selectValue, pending, defaultLabel, handleChange } =
    useShiftOverride(entry, workDate);

  return (
    <TableRow className={isOverridden ? "bg-amber-50/40" : undefined}>
      <TableCell className="font-mono text-sm">{entry.employeeCode}</TableCell>
      <TableCell className="font-medium">{entry.fullName}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {entry.deptName}
      </TableCell>
      <TableCell>
        <Select
          value={selectValue}
          onValueChange={handleChange}
          disabled={pending}
        >
          <SelectTrigger className="w-52 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_OVERRIDE} className="text-muted-foreground">
              {defaultLabel}
            </SelectItem>
            {shifts.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        {isOverridden ? (
          <Badge
            variant="secondary"
            className="bg-amber-100 text-amber-800 hover:bg-amber-100"
          >
            Override
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-muted-foreground">
            Default
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

// ─── Single roster card (mobile, below md) ───────────────────────────────────

function RosterCard({
  entry,
  shifts,
  workDate,
}: {
  entry: RosterEntry;
  shifts: ShiftOption[];
  workDate: string;
}) {
  const { isOverridden, selectValue, pending, defaultLabel, handleChange } =
    useShiftOverride(entry, workDate);

  return (
    <div
      className={`border rounded-lg p-4 space-y-3 ${
        isOverridden ? "bg-amber-50/40" : "bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{entry.fullName}</div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {entry.employeeCode} · {entry.deptName}
          </div>
        </div>
        {isOverridden ? (
          <Badge
            variant="secondary"
            className="bg-amber-100 text-amber-800 hover:bg-amber-100 shrink-0"
          >
            Override
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-muted-foreground shrink-0">
            Default
          </Badge>
        )}
      </div>

      <Select value={selectValue} onValueChange={handleChange} disabled={pending}>
        <SelectTrigger className="w-full text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_OVERRIDE} className="text-muted-foreground">
            {defaultLabel}
          </SelectItem>
          {shifts.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Roster table ─────────────────────────────────────────────────────────────

export function RosterTable({
  entries,
  shifts,
  workDate,
}: {
  entries: RosterEntry[];
  shifts: ShiftOption[];
  workDate: string;
}) {
  const overrideCount = entries.filter((e) => e.overrideShiftId !== null).length;

  return (
    <div className="space-y-3">
      {/* Table — desktop (md and up), unchanged */}
      <div className="hidden md:block border rounded-lg bg-white overflow-hidden">
        {overrideCount > 0 && (
          <div className="px-4 py-2 bg-amber-50 border-b text-sm text-amber-700 flex items-center gap-1.5">
            <span className="font-semibold">{overrideCount}</span>
            {overrideCount === 1 ? "worker has" : "workers have"} a shift
            override for this date.
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Shift for this day</TableHead>
              <TableHead className="w-24">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground py-10"
                >
                  No active workers found for this terminal.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <RosterRow
                  key={`${entry.workerId}-${workDate}`}
                  entry={entry}
                  shifts={shifts}
                  workDate={workDate}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Cards — mobile (below md), same data/controls as the desktop table */}
      <div className="md:hidden space-y-3">
        {overrideCount > 0 && (
          <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700 flex items-center gap-1.5">
            <span className="font-semibold">{overrideCount}</span>
            {overrideCount === 1 ? "worker has" : "workers have"} a shift
            override for this date.
          </div>
        )}
        {entries.length === 0 ? (
          <div className="border rounded-lg bg-white p-8 text-center text-muted-foreground text-sm">
            No active workers found for this terminal.
          </div>
        ) : (
          entries.map((entry) => (
            <RosterCard
              key={`${entry.workerId}-${workDate}-card`}
              entry={entry}
              shifts={shifts}
              workDate={workDate}
            />
          ))
        )}
      </div>
    </div>
  );
}
