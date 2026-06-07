"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  action: string;
  entityId: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  workerName: string | null;
  workerCode: string | null;
  workDate: string | null;
}

// ─── Static maps ──────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  correct_times: "Corrected times",
  create_record: "Created record",
  mark_absent: "Marked absent",
  mark_leave: "Marked leave",
};

const ACTION_COLORS: Record<
  string,
  { bg: string; text: string }
> = {
  correct_times: { bg: "bg-blue-100", text: "text-blue-700" },
  create_record: { bg: "bg-green-100", text: "text-green-700" },
  mark_absent: { bg: "bg-red-100", text: "text-red-700" },
  mark_leave: { bg: "bg-purple-100", text: "text-purple-700" },
};

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  checkInAt: "Check-in",
  checkOutAt: "Check-out",
  leaveReason: "Leave reason",
  isLate: "Late",
  lateMinutes: "Late minutes",
  leftEarly: "Left early",
  earlyLeaveMinutes: "Early leave minutes",
  overtimeMinutes: "Overtime minutes",
  workedMinutes: "Worked minutes",
  checkoutMissing: "Missing checkout",
};

const FIELD_ORDER = [
  "status",
  "checkInAt",
  "checkOutAt",
  "leaveReason",
  "isLate",
  "lateMinutes",
  "leftEarly",
  "earlyLeaveMinutes",
  "overtimeMinutes",
  "workedMinutes",
  "checkoutMissing",
];

const MONTHS_SHORT = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

// ─── Formatting helpers ────────────────────────────────────────────────────────

function fmtTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS_SHORT[d.getMonth()];
  const year = d.getFullYear();
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return {
    date: `${day} ${mon} ${year}`,
    time: `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`,
  };
}

function fmtWorkDate(workDate: string | null): string {
  if (!workDate) return "—";
  const [y, mo, d] = workDate.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS_SHORT[mo - 1]} ${y}`;
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (key.toLowerCase().includes("minutes")) return `${value}m`;
    return String(value);
  }
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      const d = new Date(value);
      const h = d.getHours();
      const m = d.getMinutes();
      const ampm = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 || 12;
      return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
    }
    return value;
  }
  return JSON.stringify(value);
}

// ─── Diff rows builder ────────────────────────────────────────────────────────

function buildDiffRows(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
) {
  const allKeys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  const sorted = Array.from(allKeys).sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return sorted.map((key) => {
    const bVal = before?.[key] ?? null;
    const aVal = after?.[key] ?? null;
    const changed = JSON.stringify(bVal) !== JSON.stringify(aVal);
    return {
      key,
      label: FIELD_LABELS[key] ?? key,
      before: formatFieldValue(key, bVal),
      after: formatFieldValue(key, aVal),
      changed,
    };
  });
}

// ─── Diff dialog ──────────────────────────────────────────────────────────────

function DiffDialog({
  entry,
  onClose,
}: {
  entry: AuditEntry;
  onClose: () => void;
}) {
  const { date, time } = fmtTimestamp(entry.createdAt);
  const rows = buildDiffRows(entry.beforeJson, entry.afterJson);
  const actionLabel =
    ACTION_LABELS[entry.action] ?? entry.action.replace(/_/g, " ");

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change details</DialogTitle>
        </DialogHeader>

        {/* Meta */}
        <div className="space-y-0.5 text-sm pb-2 border-b">
          <div className="flex items-center gap-2 flex-wrap">
            <ActionBadge action={entry.action} />
            {entry.workerName && (
              <span className="font-medium">
                {entry.workerName}
                {entry.workerCode && (
                  <span className="text-muted-foreground font-normal ml-1">
                    ({entry.workerCode})
                  </span>
                )}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">
            Work date: {fmtWorkDate(entry.workDate)}
          </p>
          <p className="text-muted-foreground">
            Changed by{" "}
            <span className="text-foreground font-medium">
              {entry.actorName ?? entry.actorEmail ?? "Unknown"}
            </span>{" "}
            on {date} at {time}
          </p>
        </div>

        {/* Diff table */}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No field data recorded.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground w-36">
                  Field
                </th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground w-[40%]">
                  Before
                </th>
                <th className="text-left py-2 font-medium text-muted-foreground">
                  After
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={
                    row.changed
                      ? "bg-amber-50/60"
                      : undefined
                  }
                >
                  <td className="py-1.5 pr-4 text-muted-foreground font-medium">
                    {row.label}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-500 tabular-nums">
                    {row.before}
                  </td>
                  <td
                    className={`py-1.5 tabular-nums font-medium ${
                      row.changed ? "text-foreground" : "text-slate-500"
                    }`}
                  >
                    {row.after}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Action badge ─────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const label = ACTION_LABELS[action] ?? action.replace(/_/g, " ");
  const colors = ACTION_COLORS[action] ?? {
    bg: "bg-slate-100",
    text: "text-slate-600",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}
    >
      {label}
    </span>
  );
}

// ─── Period selector ──────────────────────────────────────────────────────────

function PeriodButton({
  label,
  value,
  current,
}: {
  label: string;
  value: string;
  current: string;
}) {
  const active = value === current;
  return (
    <a
      href={`/dashboard/audit?period=${value}`}
      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
        active
          ? "bg-primary text-white border-primary"
          : "bg-white text-muted-foreground border-border hover:bg-slate-50"
      }`}
    >
      {label}
    </a>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function AuditClient({
  period,
  entries,
  capped,
}: {
  period: string;
  entries: AuditEntry[];
  capped: boolean;
}) {
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const filtered = entries.filter((e) => {
    if (actionFilter && e.action !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchWorker = e.workerName?.toLowerCase().includes(q) ?? false;
      const matchActor = e.actorName?.toLowerCase().includes(q) ?? false;
      if (!matchWorker && !matchActor) return false;
    }
    return true;
  });

  const uniqueActions = Array.from(new Set(entries.map((e) => e.action))).sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Every attendance correction, who made it, and exactly what changed
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-1.5">
          <PeriodButton label="Today" value="today" current={period} />
          <PeriodButton label="Last 7 days" value="7d" current={period} />
          <PeriodButton label="Last 30 days" value="30d" current={period} />
          <PeriodButton label="Last 90 days" value="90d" current={period} />
        </div>
      </div>

      {/* Cap notice */}
      {capped && (
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Showing 200 most recent entries for this period. Narrow the date
          range to see older entries.
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by worker or actor name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded-md px-3 py-1.5 text-sm bg-white outline-none focus:ring-1 focus:ring-primary w-64"
        />

        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="border rounded-md px-2 py-1.5 text-sm bg-white outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All actions</option>
          {uniqueActions.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a] ?? a}
            </option>
          ))}
        </select>

        <span className="text-sm text-muted-foreground">
          {filtered.length === entries.length
            ? `${entries.length} entr${entries.length !== 1 ? "ies" : "y"}`
            : `${filtered.length} of ${entries.length}`}
        </span>
      </div>

      {/* Table */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-36">Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead className="hidden md:table-cell">Work date</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-10"
                >
                  {entries.length === 0
                    ? "No audit entries for this period."
                    : "No entries match your filters."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => {
                const { date, time } = fmtTimestamp(entry.createdAt);
                return (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{time}</div>
                      <div className="text-xs text-muted-foreground">
                        {date}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-medium">
                        {entry.actorName ?? "—"}
                      </span>
                      {entry.actorEmail && (
                        <div className="text-xs text-muted-foreground truncate max-w-[140px]">
                          {entry.actorEmail}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <ActionBadge action={entry.action} />
                    </TableCell>
                    <TableCell>
                      {entry.workerName ? (
                        <>
                          <span className="text-sm font-medium">
                            {entry.workerName}
                          </span>
                          {entry.workerCode && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {entry.workerCode}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {fmtWorkDate(entry.workDate)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 px-2"
                        onClick={() => setSelectedEntry(entry)}
                      >
                        View →
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Diff dialog */}
      {selectedEntry && (
        <DiffDialog
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      )}
    </div>
  );
}
