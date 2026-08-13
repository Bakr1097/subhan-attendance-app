/**
 * Inline self-checks for the max open-shift cap logic (Step 24).
 * Run with:  npx tsx src/lib/punch-resolution.test.ts
 *
 * `isOpenRecordStale` lives in open-shift-cap.ts specifically so it can be
 * imported here without pulling in the database client that
 * punch-resolution.ts (which uses it) requires at load time. The rest of
 * punch-resolution.ts talks to the database directly and is exercised in the
 * live app instead (see HANDOFF Step 24).
 */

import { isOpenRecordStale } from "./open-shift-cap";

// ---------------------------------------------------------------------------
// Tiny test harness (same shape as attendance.test.ts)
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

/** Helper: build a UTC Date from an ISO-like string at Zulu time. */
function d(iso: string): Date {
  return new Date(iso + ".000Z");
}

function hoursLater(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

const CHECK_IN = d("2024-06-04T20:00:00");
const DEFAULT_CAP = 14;

console.log("── isOpenRecordStale (Step 24 max open-shift cap) ──");

// Punch 8h after check-in → within cap → NOT stale → closes as checkout.
assert(
  "punch 8h after check-in is not stale (closes as checkout)",
  isOpenRecordStale(CHECK_IN, hoursLater(CHECK_IN, 8), DEFAULT_CAP) === false
);

// Punch 20h after check-in → past cap → stale → new check-in, old record left open.
assert(
  "punch 20h after check-in is stale (becomes new check-in)",
  isOpenRecordStale(CHECK_IN, hoursLater(CHECK_IN, 20), DEFAULT_CAP) === true
);

// Punch exactly at the cap boundary → inclusive → NOT stale → still closes.
assert(
  "punch exactly at the 14h cap boundary is not stale (inclusive, closes)",
  isOpenRecordStale(CHECK_IN, hoursLater(CHECK_IN, 14), DEFAULT_CAP) === false
);

// Just one minute past the boundary → stale.
assert(
  "punch one minute past the cap boundary is stale",
  isOpenRecordStale(CHECK_IN, hoursLater(CHECK_IN, 14.0167), DEFAULT_CAP) === true
);

// Overnight shift checkout at 13h (e.g. 8pm check-in, 9am checkout) still closes.
assert(
  "overnight shift checkout at 13h still closes correctly",
  isOpenRecordStale(CHECK_IN, hoursLater(CHECK_IN, 13), DEFAULT_CAP) === false
);

// A custom (admin-configured) cap is respected, not just the 14h default.
assert(
  "custom cap of 8h: a 10h-later punch is stale",
  isOpenRecordStale(CHECK_IN, hoursLater(CHECK_IN, 10), 8) === true
);
assert(
  "custom cap of 8h: a 6h-later punch is not stale",
  isOpenRecordStale(CHECK_IN, hoursLater(CHECK_IN, 6), 8) === false
);

console.log("\n" + "─".repeat(48));
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log("─".repeat(48));

if (failed > 0) {
  process.exitCode = 1;
}
