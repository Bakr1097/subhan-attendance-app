/**
 * Inline self-checks for the attendance engine.
 * Run with:  npx tsx src/lib/attendance.test.ts
 */

import {
  resolveShift,
  computeLate,
  computeEarlyLeave,
  computeOvertime,
  computeWorkedMinutes,
  flagMissingCheckout,
  countDaysWorked,
  computeAllFlags,
  type ShiftData,
} from "./attendance";

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    failed++;
  }
}

function eq<T>(label: string, actual: T, expected: T) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(label, ok);
  if (!ok) {
    console.error(`       expected → ${JSON.stringify(expected)}`);
    console.error(`       received → ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORK_DATE = "2024-06-04";
const NEXT_DATE  = "2024-06-05";

/** Helper: build a UTC Date from an ISO-like string at Zulu time. */
function d(iso: string): Date {
  return new Date(iso + ".000Z");
}

/** Morning shift: 06:00 – 14:00, grace 10 min each side. */
const morning: ShiftData = {
  startTime:               "06:00",
  endTime:                 "14:00",
  graceMinutes:            10,
  earlyLeaveGraceMinutes:  10,
  crossesMidnight:         false,
};

/** Night shift: 22:00 – 06:00 next day, grace 10 min. */
const night: ShiftData = {
  startTime:               "22:00",
  endTime:                 "06:00",
  graceMinutes:            10,
  earlyLeaveGraceMinutes:  10,
  crossesMidnight:         true,
};

/** Zero-grace shift for exact-boundary tests. */
const zeroGrace: ShiftData = {
  ...morning,
  graceMinutes:           0,
  earlyLeaveGraceMinutes: 0,
};

// ---------------------------------------------------------------------------
// 1. resolveShift
// ---------------------------------------------------------------------------
console.log("\n── resolveShift ──");

eq("override wins when both present",
  resolveShift(morning, night), night);

eq("default used when no override",
  resolveShift(morning, null), morning);

eq("null when both null",
  resolveShift(null, null), null);

eq("override used even when default is null",
  resolveShift(null, night), night);

// ---------------------------------------------------------------------------
// 2. computeLate
// ---------------------------------------------------------------------------
console.log("\n── computeLate (morning 06:00, grace 10 min) ──");

eq("no check-in → not late",
  computeLate(null, morning, WORK_DATE),
  { isLate: false, lateMinutes: 0 });

eq("check-in exactly at start → not late",
  computeLate(d("2024-06-04T06:00:00"), morning, WORK_DATE),
  { isLate: false, lateMinutes: 0 });

eq("check-in 5 min after start (within grace) → not late",
  computeLate(d("2024-06-04T06:05:00"), morning, WORK_DATE),
  { isLate: false, lateMinutes: 0 });

eq("check-in exactly at grace threshold (06:10) → not late",
  computeLate(d("2024-06-04T06:10:00"), morning, WORK_DATE),
  { isLate: false, lateMinutes: 0 });

eq("check-in 1 min past threshold (06:11) → late 1 min",
  computeLate(d("2024-06-04T06:11:00"), morning, WORK_DATE),
  { isLate: true, lateMinutes: 1 });

eq("check-in 30 min late (06:40) → late 30 min",
  computeLate(d("2024-06-04T06:40:00"), morning, WORK_DATE),
  { isLate: true, lateMinutes: 30 });

eq("zero-grace: 1 sec past start → late 0 min (truncated), isLate true",
  computeLate(d("2024-06-04T06:00:01"), zeroGrace, WORK_DATE),
  { isLate: true, lateMinutes: 0 });

eq("zero-grace: exactly on start → not late",
  computeLate(d("2024-06-04T06:00:00"), zeroGrace, WORK_DATE),
  { isLate: false, lateMinutes: 0 });

// ---------------------------------------------------------------------------
// 3. computeEarlyLeave
// ---------------------------------------------------------------------------
console.log("\n── computeEarlyLeave (morning ends 14:00, grace 10 min) ──");

eq("no check-out → not early",
  computeEarlyLeave(null, morning, WORK_DATE),
  { leftEarly: false, earlyLeaveMinutes: 0 });

eq("check-out at exact end (14:00) → not early",
  computeEarlyLeave(d("2024-06-04T14:00:00"), morning, WORK_DATE),
  { leftEarly: false, earlyLeaveMinutes: 0 });

eq("check-out 5 min before end (within grace) → not early",
  computeEarlyLeave(d("2024-06-04T13:55:00"), morning, WORK_DATE),
  { leftEarly: false, earlyLeaveMinutes: 0 });

eq("check-out at grace threshold (13:50) → not early",
  computeEarlyLeave(d("2024-06-04T13:50:00"), morning, WORK_DATE),
  { leftEarly: false, earlyLeaveMinutes: 0 });

eq("check-out 1 min before threshold (13:49) → early 1 min",
  computeEarlyLeave(d("2024-06-04T13:49:00"), morning, WORK_DATE),
  { leftEarly: true, earlyLeaveMinutes: 1 });

eq("check-out 60 min early (13:00) → early 50 min (vs threshold 13:50)",
  computeEarlyLeave(d("2024-06-04T13:00:00"), morning, WORK_DATE),
  { leftEarly: true, earlyLeaveMinutes: 50 });

console.log("\n── computeEarlyLeave (night shift ends 06:00 NEXT day) ──");

eq("check-out at next-day 06:00 → not early",
  computeEarlyLeave(d("2024-06-05T06:00:00"), night, WORK_DATE),
  { leftEarly: false, earlyLeaveMinutes: 0 });

eq("check-out at next-day 05:49 → early 1 min (vs 05:50 threshold)",
  computeEarlyLeave(d("2024-06-05T05:49:00"), night, WORK_DATE),
  { leftEarly: true, earlyLeaveMinutes: 1 });

// ---------------------------------------------------------------------------
// 4. computeOvertime
// ---------------------------------------------------------------------------
console.log("\n── computeOvertime (morning ends 14:00) ──");

eq("no check-out → 0 overtime",
  computeOvertime(null, morning, WORK_DATE), 0);

eq("check-out exactly at end → 0 overtime",
  computeOvertime(d("2024-06-04T14:00:00"), morning, WORK_DATE), 0);

eq("check-out 30 min before end → 0 overtime",
  computeOvertime(d("2024-06-04T13:30:00"), morning, WORK_DATE), 0);

eq("check-out 30 min after end (14:30) → 30 min overtime",
  computeOvertime(d("2024-06-04T14:30:00"), morning, WORK_DATE), 30);

eq("check-out 90 min after end (15:30) → 90 min overtime",
  computeOvertime(d("2024-06-04T15:30:00"), morning, WORK_DATE), 90);

console.log("\n── computeOvertime (night shift ends 06:00 next day) ──");

eq("check-out at next-day 06:00 → 0 overtime",
  computeOvertime(d("2024-06-05T06:00:00"), night, WORK_DATE), 0);

eq("check-out 45 min after night end → 45 min overtime",
  computeOvertime(d("2024-06-05T06:45:00"), night, WORK_DATE), 45);

// ---------------------------------------------------------------------------
// 5. computeWorkedMinutes
// ---------------------------------------------------------------------------
console.log("\n── computeWorkedMinutes ──");

eq("no check-in → null",
  computeWorkedMinutes(null, d("2024-06-04T14:00:00")), null);

eq("no check-out → null",
  computeWorkedMinutes(d("2024-06-04T06:00:00"), null), null);

eq("8-hour shift → 480 min",
  computeWorkedMinutes(
    d("2024-06-04T06:00:00"),
    d("2024-06-04T14:00:00")
  ), 480);

eq("6.5-hour shift → 390 min",
  computeWorkedMinutes(
    d("2024-06-04T07:30:00"),
    d("2024-06-04T14:00:00")
  ), 390);

eq("inverted times (checkout before checkin) → null",
  computeWorkedMinutes(
    d("2024-06-04T14:00:00"),
    d("2024-06-04T06:00:00")
  ), null);

// ---------------------------------------------------------------------------
// 6. flagMissingCheckout
// ---------------------------------------------------------------------------
console.log("\n── flagMissingCheckout (morning ends 14:00) ──");

eq("no check-in → false",
  flagMissingCheckout(null, null, morning, WORK_DATE, d("2024-06-04T15:00:00")),
  false);

eq("has check-out → false",
  flagMissingCheckout(
    d("2024-06-04T06:00:00"),
    d("2024-06-04T14:00:00"),
    morning, WORK_DATE, d("2024-06-04T15:00:00")
  ), false);

eq("checked in, shift still running (now = 13:00) → false",
  flagMissingCheckout(
    d("2024-06-04T06:00:00"),
    null,
    morning, WORK_DATE, d("2024-06-04T13:00:00")
  ), false);

eq("checked in, exactly at shift end (now = 14:00) → false",
  flagMissingCheckout(
    d("2024-06-04T06:00:00"),
    null,
    morning, WORK_DATE, d("2024-06-04T14:00:00")
  ), false);

eq("checked in, shift ended (now = 14:01) → true",
  flagMissingCheckout(
    d("2024-06-04T06:00:00"),
    null,
    morning, WORK_DATE, d("2024-06-04T14:01:00")
  ), true);

eq("night shift: checked in, end not yet reached (now = 05:00 next day) → false",
  flagMissingCheckout(
    d("2024-06-04T22:00:00"),
    null,
    night, WORK_DATE, d("2024-06-05T05:00:00")
  ), false);

eq("night shift: checked in, end passed (now = 06:01 next day) → true",
  flagMissingCheckout(
    d("2024-06-04T22:00:00"),
    null,
    night, WORK_DATE, d("2024-06-05T06:01:00")
  ), true);

// ---------------------------------------------------------------------------
// 7. countDaysWorked
// ---------------------------------------------------------------------------
console.log("\n── countDaysWorked ──");

eq("empty list → 0",
  countDaysWorked([]), 0);

eq("all present → full count",
  countDaysWorked([
    { status: "present" },
    { status: "present" },
    { status: "present" },
  ]), 3);

eq("mixed statuses → only present counted",
  countDaysWorked([
    { status: "present" },
    { status: "absent" },
    { status: "leave" },
    { status: "present" },
  ]), 2);

eq("all absent → 0",
  countDaysWorked([{ status: "absent" }, { status: "absent" }]), 0);

// ---------------------------------------------------------------------------
// 8. computeAllFlags  (integration check)
// ---------------------------------------------------------------------------
console.log("\n── computeAllFlags (full punch cycle) ──");

const fullPunch = computeAllFlags(
  d("2024-06-04T06:15:00"), // 5 min past grace threshold → late 5 min
  d("2024-06-04T14:45:00"), // 45 min overtime
  morning,
  WORK_DATE,
  d("2024-06-04T15:00:00")
);
eq("late 5 min",       fullPunch.isLate,          true);
eq("lateMinutes = 5",  fullPunch.lateMinutes,      5);
eq("not early",        fullPunch.leftEarly,         false);
eq("earlyLeave = 0",   fullPunch.earlyLeaveMinutes, 0);
eq("overtime = 45",    fullPunch.overtimeMinutes,   45);
eq("worked = 510 min", fullPunch.workedMinutes,     510);
eq("no missing checkout", fullPunch.checkoutMissing, false);

const missingOut = computeAllFlags(
  d("2024-06-04T06:00:00"),
  null,
  morning,
  WORK_DATE,
  d("2024-06-04T15:00:00") // after shift end
);
eq("missing checkout flagged", missingOut.checkoutMissing, true);
eq("worked is null when no checkout", missingOut.workedMinutes, null);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${"─".repeat(44)}`);
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log(`${"─".repeat(44)}\n`);

if (failed > 0) process.exit(1);
