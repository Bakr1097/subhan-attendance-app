/**
 * One-time repair (Step 30) for the damage done while production was stuck
 * on the Step 25 deployment (2026-08-17 rollback → 2026-11-25):
 *
 *  1. Step 24's findOpenRecord() picked an arbitrary open record, so once a
 *     worker had one forgotten checkout every later punch became a new
 *     check-in. This re-pairs each worker's punches since SCOPE_START with
 *     Step 27's rules (the most recent open record within maxOpenShiftHours
 *     is closed; anything older is "incomplete").
 *  2. Repeat presses within REPEAT_MS of the last counted punch are merged.
 *  3. Flags are recomputed with the corrected (Step 29) PKT-aware engine —
 *     this covers every row the old engine created after the Sep 17 backfill.
 *  4. workDate is re-derived as the Pakistan-local date of the check-in
 *     (the bridge route used the UTC date — every 00:00–04:59 PKT punch was
 *     filed under the previous day). Applies to ALL history, not just scope.
 *
 * Every stored checkInAt/checkOutAt in scope is treated as a raw punch,
 * whatever status the row has — including rows that Step 27's live
 * auto-close has marked "incomplete" since the promotion, and any checkouts
 * it has written. Rows a person edited (an audit_log entry with an actor) and
 * rows without a check-in (absent/leave) are never touched; they still count
 * toward shiftSequence numbering.
 *
 * Each rebuilt record keeps the id of the row that held its check-in punch.
 * Rows whose punch became someone else's checkout, or was a merged repeat,
 * are deleted.
 *
 * SAFETY: dry-run by default (SELECT only). --apply writes, one transaction
 * per worker, with an audit_log row ("punch_repair_update" /
 * "punch_repair_delete") holding the full before/after for every change. It
 * refuses to run while production still writes Step 24-style
 * "stale_shift_skipped" audit rows (the old code would undo the repair), and
 * skips any worker whose records changed between planning and writing.
 *
 * Usage:
 *   npx tsx scripts/repair-punch-records.ts                 # dry run
 *   npx tsx scripts/repair-punch-records.ts --csv out.csv   # dry run + per-record CSV
 *   npx tsx scripts/repair-punch-records.ts --apply         # writes (needs approval)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { writeFileSync } from "fs";
import {
  computeAllFlags,
  computeLate,
  computeWorkedMinutes,
  flagMissingCheckout,
  type ShiftData,
} from "../src/lib/attendance";
import { resolveOpenRecords } from "../src/lib/open-shift-cap";
import { pktDateStr } from "../src/lib/pkt-time";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (expected in .env.local).");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const csvIdx = args.indexOf("--csv");
const CSV_PATH = csvIdx !== -1 ? args[csvIdx + 1] : null;

// The day before Step 24 went live (2026-08-13) — early enough that every
// record later used as a "stale" anchor is inside scope (asserted below).
const SCOPE_START = new Date("2026-08-12T00:00:00Z");
const REPEAT_MS = 5 * 60_000;
const SAMPLE_CODES = [
  "SUB-072", "SUB-061", "SUB-038", "SUB-050", "SUB-025",
  "SUB-020", "SUB-075", "SUB-066", "SUB-031", "SUB-006",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Rec {
  id: string;
  worker_id: string;
  work_date: string;
  shift_sequence: number | null;
  resolved_shift_id: string | null;
  check_in_at: Date | null;
  check_out_at: Date | null;
  check_in_photo_url: string | null;
  check_out_photo_url: string | null;
  status: string;
  is_late: boolean;
  late_minutes: number;
  left_early: boolean;
  early_leave_minutes: number;
  overtime_minutes: number;
  worked_minutes: number | null;
  checkout_missing: boolean;
  created_at: Date;
  updated_at: Date;
}

/** The columns this script may change. */
const FIELDS = [
  "work_date", "shift_sequence", "resolved_shift_id", "check_in_at", "check_out_at",
  "check_out_photo_url", "status", "is_late", "late_minutes", "left_early",
  "early_leave_minutes", "overtime_minutes", "worked_minutes", "checkout_missing",
] as const;
type Field = (typeof FIELDS)[number];
type Target = Pick<Rec, "id" | "worker_id"> & { [K in Field]: Rec[K] };

interface Plan {
  updates: { before: Rec; after: Target; changed: Field[] }[];
  deletes: { before: Rec; reason: "merged_repeat" | "became_checkout"; into: string }[];
  targets: Target[]; // every record the worker will have afterwards (incl. untouched)
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function toRec(r: Record<string, unknown>): Rec {
  const d = (v: unknown) => (v === null ? null : new Date(v as string));
  return {
    ...(r as unknown as Rec),
    work_date: r.work_date as string,
    check_in_at: d(r.check_in_at),
    check_out_at: d(r.check_out_at),
    created_at: new Date(r.created_at as string),
    updated_at: new Date(r.updated_at as string),
  };
}

async function load() {
  const [records, workers, shifts, assignments, locked, settings, anchors] =
    await sql.transaction(
      [
        // ::text — the driver otherwise returns `date` columns as JS Dates.
        sql`select *, work_date::text as work_date from attendance_records`,
        sql`select id, employee_code, full_name from workers`,
        sql`select * from shifts`,
        sql`select worker_id, work_date::text, shift_id from shift_assignments`,
        sql`select distinct entity_id from audit_log
            where entity_type = 'attendance_record' and actor_user_id is not null`,
        sql`select key, value from app_settings where key = 'maxOpenShiftHours'`,
        // Pre-scope rows used as stale anchors are fine as long as they were
        // never closed — they're plain forgotten checkouts (handled below).
        sql`select count(*)::int as closed_anchors from attendance_records ar
            where ar.check_in_at < ${SCOPE_START} and ar.check_out_at is not null
              and ar.id in (select entity_id from audit_log
                            where action in ('stale_shift_skipped', 'stale_shift_auto_closed'))`,
      ],
      { readOnly: true }
    );

  const shiftMap = new Map<string, ShiftData>(
    shifts.map((s) => [
      s.id as string,
      {
        startTime: s.start_time as string,
        endTime: s.end_time as string,
        graceMinutes: s.grace_minutes as number,
        earlyLeaveGraceMinutes: s.early_leave_grace_minutes as number,
        crossesMidnight: s.crosses_midnight as boolean,
      },
    ])
  );
  const assignmentMap = new Map<string, string>(
    assignments.map((a) => [`${a.worker_id}|${a.work_date}`, a.shift_id as string])
  );
  const n = parseInt((settings[0]?.value as string) ?? "14", 10);
  const closedAnchorsBeforeScope = anchors[0]?.closed_anchors as number;

  return {
    records: records.map(toRec),
    workers: new Map(workers.map((w) => [w.id as string, { code: w.employee_code as string, name: (w.full_name as string).trim() }])),
    shiftMap,
    assignmentMap,
    lockedIds: new Set(locked.map((l) => l.entity_id as string)),
    maxOpenShiftHours: Number.isFinite(n) && n > 0 ? n : 14,
    closedAnchorsBeforeScope,
  };
}

type Loaded = Awaited<ReturnType<typeof load>>;

// ---------------------------------------------------------------------------
// Plan one worker
// ---------------------------------------------------------------------------

function flagsFor(
  inAt: Date,
  outAt: Date | null,
  status: string,
  shift: ShiftData | null,
  workDate: string,
  now: Date
) {
  if (!shift) {
    return {
      is_late: false, late_minutes: 0, left_early: false, early_leave_minutes: 0,
      overtime_minutes: 0, worked_minutes: computeWorkedMinutes(inAt, outAt),
      checkout_missing: status === "incomplete",
    };
  }
  if (outAt) {
    const f = computeAllFlags(inAt, outAt, shift, workDate, now);
    return {
      is_late: f.isLate, late_minutes: f.lateMinutes, left_early: f.leftEarly,
      early_leave_minutes: f.earlyLeaveMinutes, overtime_minutes: f.overtimeMinutes,
      worked_minutes: f.workedMinutes, checkout_missing: false,
    };
  }
  const late = computeLate(inAt, shift, workDate);
  return {
    is_late: late.isLate, late_minutes: late.lateMinutes, left_early: false,
    early_leave_minutes: 0, overtime_minutes: 0, worked_minutes: null,
    // Same as what resolvePunch() writes: incomplete is always flagged;
    // an open record is flagged once its shift end has passed.
    checkout_missing:
      status === "incomplete" || flagMissingCheckout(inAt, null, shift, workDate, now),
  };
}

function planWorker(workerId: string, recs: Rec[], L: Loaded, now: Date): Plan {
  const isFixedRow = (r: Rec) => !r.check_in_at || L.lockedIds.has(r.id);
  const inScope = recs.filter((r) => !isFixedRow(r) && r.check_in_at! >= SCOPE_START);
  const preScope = recs.filter((r) => !isFixedRow(r) && r.check_in_at! < SCOPE_START);
  const fixed = recs.filter(isFixedRow);
  const byId = new Map(recs.map((r) => [r.id, r]));

  // 1. Raw punches from every in-scope row (check-ins AND any checkouts).
  type Punch = { t: Date; recId: string; kind: "in" | "out" };
  const raw: Punch[] = [];
  for (const r of inScope) {
    raw.push({ t: r.check_in_at!, recId: r.id, kind: "in" });
    if (r.check_out_at) raw.push({ t: r.check_out_at, recId: r.id, kind: "out" });
  }
  raw.sort((a, b) => a.t.getTime() - b.t.getTime() || (a.kind === "in" ? -1 : 1));

  // 2. Merge repeat presses: drop any punch within REPEAT_MS of the last
  //    punch that counted.
  const deletes: Plan["deletes"] = [];
  const kept: Punch[] = [];
  const mergedInto = new Map<string, string>(); // recId -> recId of the punch it merged into
  for (const p of raw) {
    const last = kept[kept.length - 1];
    if (last && p.t.getTime() - last.t.getTime() <= REPEAT_MS) {
      if (p.kind === "in") mergedInto.set(p.recId, last.recId);
      continue;
    }
    kept.push(p);
  }

  // 3. Pair with Step 27's rules: a punch closes the most recent open
  //    session within the cap; every older open session becomes incomplete.
  type Session = { inP: Punch; outP: Punch | null; status: "present" | "incomplete" };
  const sessions: Session[] = [];
  let open: Session[] = [];
  for (const p of kept) {
    if (open.length > 0) {
      const { toClose, current } = resolveOpenRecords(
        open.map((s) => ({ id: s.inP.recId, checkInAt: s.inP.t })),
        p.t,
        L.maxOpenShiftHours
      );
      for (const id of toClose) open.find((s) => s.inP.recId === id)!.status = "incomplete";
      open = open.filter((s) => !toClose.includes(s.inP.recId));
      if (current) {
        const s = open.find((x) => x.inP.recId === current)!;
        s.outP = p;
        open = open.filter((x) => x !== s);
        continue;
      }
    }
    const s: Session = { inP: p, outP: null, status: "present" };
    sessions.push(s);
    open.push(s);
  }
  // A trailing open session past the cap can never be closed by a real
  // punch any more — close it now rather than waiting for the next punch.
  for (const s of open) {
    if (now.getTime() - s.inP.t.getTime() > L.maxOpenShiftHours * 3600_000) s.status = "incomplete";
  }

  // 4. Build target rows. Each session reuses the row its check-in came from;
  //    if that row's own check-in was a checkout punch carried over from
  //    another row, it's still the row whose check_in_at == session start.
  const targets: Target[] = [];
  const usedIds = new Set<string>();
  // A roster override for the (possibly re-filed) date wins; otherwise keep
  // the shift the source row was resolved to.
  const resolveShift = (source: Rec, workDate: string) =>
    L.assignmentMap.get(`${workerId}|${workDate}`) ?? source.resolved_shift_id;

  // Sessions starting on a row's own check-in reuse that row's id. A session
  // can also start on a punch that was stored as some row's checkout (an old
  // pairing that is now wrong) — it then reuses that row's id if free, or
  // any other in-scope row of this worker that would otherwise be deleted.
  for (const s of sessions) if (s.inP.kind === "in") usedIds.add(s.inP.recId);
  const spareIds = inScope.map((r) => r.id).filter((id) => !usedIds.has(id));
  const idFor = (s: Session): string | null => {
    if (s.inP.kind === "in") return s.inP.recId;
    const own = spareIds.indexOf(s.inP.recId);
    const take = own !== -1 ? own : spareIds.length ? 0 : -1;
    return take === -1 ? null : spareIds.splice(take, 1)[0];
  };

  for (const s of sessions) {
    const source = byId.get(s.inP.recId)!;
    const id = idFor(s);
    const workDate = pktDateStr(s.inP.t);
    const shiftId = resolveShift(source, workDate);
    const shift = shiftId ? L.shiftMap.get(shiftId) ?? null : null;
    const outAt = s.outP ? s.outP.t : null;
    const outSource = s.outP ? byId.get(s.outP.recId)! : null;
    const t: Target = {
      id: id ?? `new:${source.id}:${s.inP.t.toISOString()}`,
      worker_id: workerId,
      work_date: workDate,
      shift_sequence: 0,
      resolved_shift_id: shiftId,
      check_in_at: s.inP.t,
      check_out_at: outAt,
      check_out_photo_url: !outSource
        ? null
        : s.outP!.kind === "out"
          ? outSource.check_out_photo_url
          : outSource.check_in_photo_url,
      status: s.status,
      ...flagsFor(s.inP.t, outAt, s.status, shift, workDate, now),
    };
    targets.push(t);
  }

  // Pre-scope rows: only workDate (and anything derived from it) can change,
  // plus a forgotten checkout past the cap becomes "incomplete" — exactly
  // what Step 27 does to it on the worker's next punch.
  for (const r of preScope) {
    const workDate = pktDateStr(r.check_in_at!);
    const stale =
      r.status === "present" && !r.check_out_at &&
      now.getTime() - r.check_in_at!.getTime() > L.maxOpenShiftHours * 3600_000;
    if (stale) {
      const shiftId = resolveShift(r, workDate);
      const shift = shiftId ? L.shiftMap.get(shiftId) ?? null : null;
      targets.push({
        ...pick(r),
        work_date: workDate,
        resolved_shift_id: shiftId,
        status: "incomplete",
        ...flagsFor(r.check_in_at!, null, "incomplete", shift, workDate, now),
      });
      continue;
    }
    if (workDate === r.work_date) {
      targets.push({ ...pick(r) });
      continue;
    }
    const shiftId = resolveShift(r, workDate);
    const shift = shiftId ? L.shiftMap.get(shiftId) ?? null : null;
    targets.push({
      ...pick(r),
      work_date: workDate,
      resolved_shift_id: shiftId,
      ...(r.status === "present" || r.status === "incomplete"
        ? flagsFor(r.check_in_at!, r.check_out_at, r.status, shift, workDate, now)
        : {}),
      // Historical checkoutMissing is recomputed live by the pages; keep
      // whatever was stored so this script doesn't change unrelated history.
      checkout_missing: r.checkout_missing,
    });
  }

  // 5. shiftSequence: 1..n per workDate by check-in time, counting fixed
  //    rows (which keep their own number unless it collides).
  for (const r of fixed) targets.push({ ...pick(r) });
  const byDate = new Map<string, Target[]>();
  for (const t of targets) {
    const list = byDate.get(t.work_date) ?? [];
    list.push(t);
    byDate.set(t.work_date, list);
  }
  for (const list of Array.from(byDate.values())) {
    list.sort((a, b) => (a.check_in_at?.getTime() ?? 0) - (b.check_in_at?.getTime() ?? 0));
    list.forEach((t, i) => {
      const fixedRow = fixed.find((f) => f.id === t.id);
      if (!fixedRow) t.shift_sequence = i + 1;
    });
  }

  // 6. Diff against what's stored.
  const updates: Plan["updates"] = [];
  for (const t of targets) {
    const before = byId.get(t.id);
    if (!before) continue; // "new:" ids handled below
    if (fixed.includes(before)) continue;
    const changed = FIELDS.filter((f) => !same(before[f], t[f]));
    if (changed.length) updates.push({ before, after: t, changed });
  }
  const targetIds = new Set(targets.map((t) => t.id));
  for (const r of inScope) {
    if (targetIds.has(r.id)) continue;
    const merged = mergedInto.get(r.id);
    deletes.push({
      before: r,
      reason: merged ? "merged_repeat" : "became_checkout",
      into: merged ?? sessions.find((s) => s.outP?.recId === r.id)?.inP.recId ?? "?",
    });
  }
  const orphans = targets.filter((t) => t.id.startsWith("new:"));
  if (orphans.length) {
    // Never expected (every session starts at some row's own check-in);
    // fail loudly rather than invent an insert path that was never reviewed.
    throw new Error(`worker ${workerId}: ${orphans.length} session(s) with no source row — aborting`);
  }

  return { updates, deletes, targets };
}

function allTargetsOf(plans: Map<string, Plan>) {
  return Array.from(plans.values()).flatMap((p) => p.targets);
}

function pick(r: Rec): Target {
  const t = { id: r.id, worker_id: r.worker_id } as Target;
  for (const f of FIELDS) (t as Record<string, unknown>)[f] = r[f];
  return t;
}

function same(a: unknown, b: unknown) {
  if (a instanceof Date || b instanceof Date) {
    return (a as Date | null)?.getTime?.() === (b as Date | null)?.getTime?.();
  }
  return a === b;
}

// ---------------------------------------------------------------------------
// Payroll impact (closing windows, same rule the app uses)
// ---------------------------------------------------------------------------

function closingDoubles(
  rows: { worker_id: string; check_in_at: Date | null; status: string }[],
  excludeIncomplete: boolean,
  closingDates: string[],
  cutoff = "14:30"
) {
  const [h, m] = cutoff.split(":").map(Number);
  const at = (d: string) => Date.parse(`${d}T00:00:00Z`) + (h * 60 + m - 300) * 60_000;
  let doubles = 0;
  for (const cd of closingDates) {
    const end = at(cd);
    const start = end - 86400_000;
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r.check_in_at || (excludeIncomplete && r.status === "incomplete")) continue;
      if (r.status === "absent" || r.status === "leave") continue;
      const t = r.check_in_at.getTime();
      if (t >= start && t < end) counts.set(r.worker_id, (counts.get(r.worker_id) ?? 0) + 1);
    }
    for (const c of Array.from(counts.values())) if (c >= 2) doubles++;
  }
  return doubles;
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

const pkt = (d: Date | null) =>
  d ? new Date(d.getTime() + 5 * 3600_000).toISOString().slice(5, 16).replace("T", " ") : "—";

function describe(r: Pick<Rec, Field>) {
  const late = r.late_minutes ? ` late+${r.late_minutes}m` : "";
  const ot = r.overtime_minutes ? ` OT+${r.overtime_minutes}m` : "";
  const early = r.early_leave_minutes ? ` early-${r.early_leave_minutes}m` : "";
  return `${r.work_date} #${r.shift_sequence} ${pkt(r.check_in_at)} → ${pkt(r.check_out_at)} ${r.status}${late}${early}${ot}`;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

async function applyWorker(workerId: string, plan: Plan, fingerprint: string) {
  const current = await sql`select id, updated_at from attendance_records where worker_id = ${workerId}`;
  const now = current
    .map((r) => `${r.id}@${new Date(r.updated_at as string).getTime()}`)
    .sort()
    .join(",");
  if (now !== fingerprint) return false;

  const queries = [];
  const ts = new Date();
  for (const d of plan.deletes) {
    queries.push(sql`delete from attendance_records where id = ${d.before.id}`);
    queries.push(sql`insert into audit_log (actor_user_id, action, entity_type, entity_id, before_json, after_json)
      values (null, 'punch_repair_delete', 'attendance_record', ${d.before.id},
              ${JSON.stringify(d.before)}, ${JSON.stringify({ reason: d.reason, into: d.into })})`);
  }
  for (const u of plan.updates) {
    const a = u.after;
    queries.push(sql`update attendance_records set
        work_date = ${a.work_date}, shift_sequence = ${a.shift_sequence},
        resolved_shift_id = ${a.resolved_shift_id}, check_in_at = ${a.check_in_at},
        check_out_at = ${a.check_out_at}, check_out_photo_url = ${a.check_out_photo_url},
        status = ${a.status}, is_late = ${a.is_late}, late_minutes = ${a.late_minutes},
        left_early = ${a.left_early}, early_leave_minutes = ${a.early_leave_minutes},
        overtime_minutes = ${a.overtime_minutes}, worked_minutes = ${a.worked_minutes},
        checkout_missing = ${a.checkout_missing}, updated_at = ${ts}
      where id = ${a.id}`);
    queries.push(sql`insert into audit_log (actor_user_id, action, entity_type, entity_id, before_json, after_json)
      values (null, 'punch_repair_update', 'attendance_record', ${a.id},
              ${JSON.stringify(u.before)}, ${JSON.stringify(a)})`);
  }
  if (queries.length) await sql.transaction(queries);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const now = new Date();
  const L = await load();
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN (no writes)"}   now=${now.toISOString()}   maxOpenShiftHours=${L.maxOpenShiftHours}`);

  if (L.closedAnchorsBeforeScope > 0) {
    throw new Error(`${L.closedAnchorsBeforeScope} stale anchor(s) before SCOPE_START have a check-out — widen the scope.`);
  }

  const byWorker = new Map<string, Rec[]>();
  for (const r of L.records) {
    const list = byWorker.get(r.worker_id) ?? [];
    list.push(r);
    byWorker.set(r.worker_id, list);
  }

  const plans = new Map<string, Plan>();
  for (const [wid, recs] of Array.from(byWorker)) plans.set(wid, planWorker(wid, recs, L, now));

  // ── Invariants (fail loudly rather than write a bad plan) ─────────────
  const capMs = L.maxOpenShiftHours * 3600_000;
  for (const [wid, plan] of Array.from(plans)) {
    const scoped = plan.targets.filter((t) => t.check_in_at && t.check_in_at >= SCOPE_START && !L.lockedIds.has(t.id));
    const code = L.workers.get(wid)?.code;
    for (const t of scoped) {
      if (t.check_out_at && t.check_out_at <= t.check_in_at!) throw new Error(`${code}: check-out not after check-in on ${t.id}`);
      if (t.check_out_at && t.check_out_at.getTime() - t.check_in_at!.getTime() > capMs) throw new Error(`${code}: shift longer than cap on ${t.id}`);
      if (t.work_date !== pktDateStr(t.check_in_at!)) throw new Error(`${code}: workDate not PKT date on ${t.id}`);
    }
    const open = scoped.filter((t) => t.status === "present" && !t.check_out_at);
    if (open.length > 1) throw new Error(`${code}: ${open.length} open records after repair`);
    const ids = plan.targets.map((t) => t.id);
    if (new Set(ids).size !== ids.length) throw new Error(`${code}: duplicate record id in plan`);
  }
  const punchesBefore = L.records.filter((r) => r.check_in_at && r.check_in_at >= SCOPE_START && !L.lockedIds.has(r.id))
    .reduce((n, r) => n + 1 + (r.check_out_at ? 1 : 0), 0);
  const punchesAfter = allTargetsOf(plans).filter((t) => t.check_in_at && t.check_in_at >= SCOPE_START && !L.lockedIds.has(t.id))
    .reduce((n, t) => n + 1 + (t.check_out_at ? 1 : 0), 0);
  const merged = Array.from(plans.values()).flatMap((p) => p.deletes).filter((d) => d.reason === "merged_repeat").length;
  console.log(`Invariants OK. Punches in scope: ${punchesBefore} before = ${punchesAfter} after + ${punchesBefore - punchesAfter} merged repeats (rows deleted as repeats: ${merged}).`);

  // ── Counts ────────────────────────────────────────────────────────────
  const allUpdates = Array.from(plans.values()).flatMap((p) => p.updates);
  const allDeletes = Array.from(plans.values()).flatMap((p) => p.deletes);
  const allTargets = Array.from(plans.values()).flatMap((p) => p.targets);
  const inScopeBefore = L.records.filter((r) => r.check_in_at && r.check_in_at >= SCOPE_START);
  const inScopeAfter = allTargets.filter((t) => t.check_in_at && t.check_in_at >= SCOPE_START);
  const sep17 = new Date("2026-09-17T15:52:34Z"); // Step 29 backfill / deploy build
  const flagFields: Field[] = ["is_late", "late_minutes", "left_early", "early_leave_minutes", "overtime_minutes"];
  const refiled = allUpdates.filter((u) => u.changed.includes("work_date"));

  const closingDates: string[] = [];
  for (let i = 29; i >= 0; i--) closingDates.push(pktDateStr(new Date(now.getTime() - i * 86400_000)));

  console.log("\n── Counts ──");
  console.table({
    "records in table": { before: L.records.length, after: L.records.length - allDeletes.length },
    [`in scope (check-in ≥ ${SCOPE_START.toISOString().slice(0, 10)})`]: { before: inScopeBefore.length, after: inScopeAfter.length },
    "  with a check-out": {
      before: inScopeBefore.filter((r) => r.check_out_at).length,
      after: inScopeAfter.filter((t) => t.check_out_at).length,
    },
    "  incomplete (auto-closed)": {
      before: inScopeBefore.filter((r) => r.status === "incomplete").length,
      after: inScopeAfter.filter((t) => t.status === "incomplete").length,
    },
    "  still open (present, no check-out)": {
      before: inScopeBefore.filter((r) => r.status === "present" && !r.check_out_at).length,
      after: inScopeAfter.filter((t) => t.status === "present" && !t.check_out_at).length,
    },
    "payroll auto-doubles, last 30 closings": {
      before: closingDoubles(L.records, false, closingDates), // live Step 25 rule
      after: closingDoubles(allTargets, true, closingDates), // Step 27 rule
    },
  });
  console.log("Changes:");
  console.table({
    "rows deleted — merged repeat press (≤5 min)": allDeletes.filter((d) => d.reason === "merged_repeat").length,
    "rows deleted — punch became another row's check-out": allDeletes.filter((d) => d.reason === "became_checkout").length,
    "rows updated": allUpdates.length,
    "  re-filed to PKT workDate (in scope)": refiled.filter((u) => u.before.check_in_at! >= SCOPE_START).length,
    "  re-filed to PKT workDate (before scope)": refiled.filter((u) => u.before.check_in_at! < SCOPE_START).length,
    "  any flag changed": allUpdates.filter((u) => u.changed.some((f) => flagFields.includes(f))).length,
    "  flag changed, row created since Step 29 backfill": allUpdates.filter(
      (u) => u.before.created_at > sep17 && u.changed.some((f) => flagFields.includes(f))
    ).length,
    "  shiftSequence only": allUpdates.filter((u) => u.changed.length === 1 && u.changed[0] === "shift_sequence").length,
    "rows never touched (human-edited or absent/leave)": L.records.filter((r) => !r.check_in_at || L.lockedIds.has(r.id)).length,
    "workers affected": new Set([...allUpdates.map((u) => u.before.worker_id), ...allDeletes.map((d) => d.before.worker_id)]).size,
  });

  // ── Samples ───────────────────────────────────────────────────────────
  console.log("\n── Sample workers: Nov 22–25 before → after (times PKT) ──");
  const codeToId = new Map(Array.from(L.workers).map(([id, w]) => [w.code, id]));
  const inWindow = (d: Date | null) => !!d && d >= new Date("2026-11-21T19:00:00Z");
  for (const code of SAMPLE_CODES) {
    const wid = codeToId.get(code);
    if (!wid) continue;
    const w = L.workers.get(wid)!;
    const before = (byWorker.get(wid) ?? []).filter((r) => inWindow(r.check_in_at)).sort((a, b) => a.check_in_at!.getTime() - b.check_in_at!.getTime());
    const after = plans.get(wid)!.targets.filter((t) => inWindow(t.check_in_at)).sort((a, b) => a.check_in_at!.getTime() - b.check_in_at!.getTime());
    console.log(`\n${code} ${w.name}`);
    console.log(`  BEFORE (${before.length}):`);
    for (const r of before) console.log(`    ${describe(r)}`);
    console.log(`  AFTER (${after.length}):`);
    for (const t of after) console.log(`    ${describe(t)}`);
  }

  if (CSV_PATH) {
    const lines = ["action,worker,record_id,changed,before,after"];
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    for (const u of allUpdates) {
      lines.push(["update", L.workers.get(u.before.worker_id)?.code ?? "", u.before.id, u.changed.join("|"), esc(describe(u.before)), esc(describe(u.after))].join(","));
    }
    for (const d of allDeletes) {
      lines.push(["delete:" + d.reason, L.workers.get(d.before.worker_id)?.code ?? "", d.before.id, "", esc(describe(d.before)), esc(`into ${d.into}`)].join(","));
    }
    writeFileSync(CSV_PATH, lines.join("\n"));
    console.log(`\nWrote ${lines.length - 1} rows to ${CSV_PATH}`);
  }

  if (!APPLY) {
    console.log("\nDry run only — nothing was written.");
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────
  const [recent] = await sql`select max(created_at) as last from audit_log where action = 'stale_shift_skipped'`;
  if (recent?.last && now.getTime() - new Date(recent.last as string).getTime() < 2 * 3600_000) {
    throw new Error(
      `Production wrote a Step 24-style stale_shift_skipped row at ${recent.last} — it is still running pre-Step-27 code, which would undo this repair. Aborting.`
    );
  }
  let done = 0;
  let skipped = 0;
  for (const [wid, plan] of Array.from(plans)) {
    if (!plan.updates.length && !plan.deletes.length) continue;
    const fp = (byWorker.get(wid) ?? [])
      .map((r) => `${r.id}@${r.updated_at.getTime()}`)
      .sort()
      .join(",");
    if (await applyWorker(wid, plan, fp)) done++;
    else {
      skipped++;
      console.log(`  skipped ${L.workers.get(wid)?.code}: records changed since planning — re-run to pick it up`);
    }
  }
  console.log(`\nApplied to ${done} worker(s); skipped ${skipped}. Re-run the dry run to confirm 0 remaining changes.`);
}

main().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exitCode = 1;
});
