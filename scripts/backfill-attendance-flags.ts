/**
 * Standalone backfill: recompute isLate / lateMinutes / leftEarly /
 * earlyLeaveMinutes / overtimeMinutes on every existing attendance_records
 * row, using the corrected PKT-aware attendance engine (see attendance.ts's
 * buildUtcDate fix). Every row currently in the database was computed under
 * the old bug, which mislabeled shift start/end times as UTC instead of
 * Pakistan local time (a fixed +5h/300min misregistration) — so these five
 * columns are wrong on essentially every row with a check-in or check-out.
 *
 * This script is intentionally NOT part of the Next.js app (no route, no
 * server action) — it's a one-off, run manually from the CLI, exactly once,
 * against the real database. It never touches workedMinutes (unaffected —
 * it's just checkOutAt - checkInAt, both real UTC instants) or
 * checkoutMissing (re-evaluated live against current time elsewhere; a
 * historical "now" for old rows isn't meaningful to backfill).
 *
 * SAFETY: defaults to dry-run — it only SELECTs, computes the diff, and
 * prints a report. It never writes unless invoked with --apply, and even
 * then it re-checks each row's current values right before writing (see
 * runApply) so nothing added to the table between the dry run and the real
 * run gets silently skipped or double-processed.
 *
 * Usage:
 *   npx tsx scripts/backfill-attendance-flags.ts            # dry run (default)
 *   npx tsx scripts/backfill-attendance-flags.ts --dry-run   # same, explicit
 *   npx tsx scripts/backfill-attendance-flags.ts --apply     # writes changes
 *   npx tsx scripts/backfill-attendance-flags.ts --apply --csv out.csv
 *
 * --csv <path>  also writes a full per-row diff to a CSV file (dry-run or
 *               apply) — useful when there are more changed rows than fit
 *               comfortably in a terminal.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { writeFileSync } from "fs";
import { attendanceRecords, shifts } from "../src/db/schema";
import { computeLate, computeEarlyLeave, computeOvertime, type ShiftData } from "../src/lib/attendance";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (expected in .env.local).");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const db = drizzle(sql);

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const csvFlagIndex = args.indexOf("--csv");
const CSV_PATH = csvFlagIndex !== -1 ? args[csvFlagIndex + 1] : null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Row = typeof attendanceRecords.$inferSelect;
type ShiftRow = typeof shifts.$inferSelect;

interface FieldDiff {
  field: "isLate" | "lateMinutes" | "leftEarly" | "earlyLeaveMinutes" | "overtimeMinutes";
  oldValue: unknown;
  newValue: unknown;
}

interface RowDiff {
  recordId: string;
  workerId: string;
  workDate: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  shiftId: string | null;
  diffs: FieldDiff[];
}

// ---------------------------------------------------------------------------
// Recompute logic — mirrors computeAllFlags, minus workedMinutes/checkoutMissing
// ---------------------------------------------------------------------------

function recompute(row: Row, shift: ShiftRow) {
  const shiftData: ShiftData = {
    startTime: shift.startTime,
    endTime: shift.endTime,
    graceMinutes: shift.graceMinutes,
    earlyLeaveGraceMinutes: shift.earlyLeaveGraceMinutes,
    crossesMidnight: shift.crossesMidnight,
  };

  const checkInAt = row.checkInAt ? new Date(row.checkInAt) : null;
  const checkOutAt = row.checkOutAt ? new Date(row.checkOutAt) : null;

  const late = computeLate(checkInAt, shiftData, row.workDate);
  const early = computeEarlyLeave(checkOutAt, shiftData, row.workDate);
  const overtimeMinutes = computeOvertime(checkOutAt, shiftData, row.workDate);

  return {
    isLate: late.isLate,
    lateMinutes: late.lateMinutes,
    leftEarly: early.leftEarly,
    earlyLeaveMinutes: early.earlyLeaveMinutes,
    overtimeMinutes,
  };
}

function diffRow(row: Row, shift: ShiftRow): RowDiff | null {
  const next = recompute(row, shift);
  const diffs: FieldDiff[] = [];

  if (row.isLate !== next.isLate) diffs.push({ field: "isLate", oldValue: row.isLate, newValue: next.isLate });
  if (row.lateMinutes !== next.lateMinutes) diffs.push({ field: "lateMinutes", oldValue: row.lateMinutes, newValue: next.lateMinutes });
  if (row.leftEarly !== next.leftEarly) diffs.push({ field: "leftEarly", oldValue: row.leftEarly, newValue: next.leftEarly });
  if (row.earlyLeaveMinutes !== next.earlyLeaveMinutes) diffs.push({ field: "earlyLeaveMinutes", oldValue: row.earlyLeaveMinutes, newValue: next.earlyLeaveMinutes });
  if (row.overtimeMinutes !== next.overtimeMinutes) diffs.push({ field: "overtimeMinutes", oldValue: row.overtimeMinutes, newValue: next.overtimeMinutes });

  if (diffs.length === 0) return null;

  return {
    recordId: row.id,
    workerId: row.workerId,
    workDate: row.workDate,
    checkInAt: row.checkInAt ? new Date(row.checkInAt).toISOString() : null,
    checkOutAt: row.checkOutAt ? new Date(row.checkOutAt).toISOString() : null,
    shiftId: row.resolvedShiftId,
    diffs,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (will write to the database)" : "DRY RUN (no writes)"}`);
  console.log("Loading attendance_records and shifts...\n");

  const allRecords = await db.select().from(attendanceRecords);
  const allShifts = await db.select().from(shifts);
  const shiftMap = new Map(allShifts.map((s) => [s.id, s]));

  let scanned = 0;
  let skippedNoShift = 0;
  let unchanged = 0;
  const changed: RowDiff[] = [];
  const fieldChangeCounts: Record<FieldDiff["field"], number> = {
    isLate: 0,
    lateMinutes: 0,
    leftEarly: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
  };

  for (const row of allRecords) {
    scanned++;
    if (!row.resolvedShiftId) {
      skippedNoShift++;
      continue;
    }
    const shift = shiftMap.get(row.resolvedShiftId);
    if (!shift) {
      skippedNoShift++;
      continue;
    }

    const diff = diffRow(row, shift);
    if (!diff) {
      unchanged++;
      continue;
    }
    changed.push(diff);
    for (const d of diff.diffs) fieldChangeCounts[d.field]++;
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------

  console.log("── Summary ──");
  console.log(`  Total attendance_records rows scanned: ${scanned}`);
  console.log(`  Skipped (no resolved shift to compare against): ${skippedNoShift}`);
  console.log(`  Unchanged (already correct): ${unchanged}`);
  console.log(`  Changed: ${changed.length}`);
  console.log("\n  Changes by field:");
  for (const [field, count] of Object.entries(fieldChangeCounts)) {
    console.log(`    ${field.padEnd(20)} ${count}`);
  }

  if (changed.length > 0) {
    console.log("\n── Sample of changed rows (first 25) ──");
    for (const r of changed.slice(0, 25)) {
      console.log(`\n  record ${r.recordId}  worker ${r.workerId}  workDate ${r.workDate}`);
      console.log(`    checkInAt=${r.checkInAt ?? "—"}  checkOutAt=${r.checkOutAt ?? "—"}  shift=${r.shiftId}`);
      for (const d of r.diffs) {
        console.log(`    ${d.field}: ${JSON.stringify(d.oldValue)} → ${JSON.stringify(d.newValue)}`);
      }
    }
    if (changed.length > 25) {
      console.log(`\n  ...and ${changed.length - 25} more changed rows (see CSV for the full list).`);
    }
  }

  if (CSV_PATH) {
    const lines = ["recordId,workerId,workDate,checkInAt,checkOutAt,shiftId,field,oldValue,newValue"];
    for (const r of changed) {
      for (const d of r.diffs) {
        lines.push(
          [r.recordId, r.workerId, r.workDate, r.checkInAt ?? "", r.checkOutAt ?? "", r.shiftId ?? "", d.field, d.oldValue, d.newValue]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        );
      }
    }
    writeFileSync(CSV_PATH, lines.join("\n") + "\n");
    console.log(`\nFull diff written to ${CSV_PATH} (${changed.length} rows, ${lines.length - 1} field-change lines).`);
  }

  if (!APPLY) {
    console.log("\nDry run only — no rows were modified. Re-run with --apply to write these changes.");
    return;
  }

  // -------------------------------------------------------------------------
  // Apply — re-check each row immediately before writing, one at a time,
  // so a row changed by the live app between the dry run and now (e.g. a
  // supervisor's manual correction) isn't clobbered with a stale diff.
  // -------------------------------------------------------------------------

  console.log("\nApplying changes...");
  let applied = 0;
  let skippedRace = 0;

  for (const diff of changed) {
    const [current] = await db
      .select()
      .from(attendanceRecords)
      .where(eq(attendanceRecords.id, diff.recordId))
      .limit(1);
    if (!current || !current.resolvedShiftId) {
      skippedRace++;
      continue;
    }
    const shift = shiftMap.get(current.resolvedShiftId);
    if (!shift) {
      skippedRace++;
      continue;
    }

    const recheck = diffRow(current, shift);
    if (!recheck) {
      // Someone already corrected this row (or it changed) since the dry run.
      skippedRace++;
      continue;
    }

    const next = recompute(current, shift);
    await db
      .update(attendanceRecords)
      .set({
        isLate: next.isLate,
        lateMinutes: next.lateMinutes,
        leftEarly: next.leftEarly,
        earlyLeaveMinutes: next.earlyLeaveMinutes,
        overtimeMinutes: next.overtimeMinutes,
        updatedAt: new Date(),
      })
      .where(eq(attendanceRecords.id, current.id));
    applied++;
  }

  console.log(`\nApplied ${applied} row updates. Skipped ${skippedRace} rows that changed since the dry run.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
