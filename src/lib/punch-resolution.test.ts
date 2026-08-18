/**
 * Inline self-checks for the max open-shift cap logic (Step 24) and the
 * deterministic open-record resolution / duplicate detection built on top of
 * it (Step 27).
 * Run with:  npx tsx src/lib/punch-resolution.test.ts
 *
 * All three functions live in open-shift-cap.ts specifically so they can be
 * imported here without pulling in the database client that
 * punch-resolution.ts (which uses them) requires at load time. The rest of
 * punch-resolution.ts talks to the database directly and is exercised in the
 * live app instead (see HANDOFF Steps 24 and 27).
 */

import {
  isOpenRecordStale,
  resolveOpenRecords,
  findDuplicateRecord,
} from "./open-shift-cap";

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

console.log("\n── resolveOpenRecords (Step 27 deterministic selection) ──");

// Single open record, not stale → it's "current", nothing to close.
// (This is also the ordinary single-open-record path and the overnight-shift
// checkout path, unchanged from before Step 27.)
{
  const openCheckIn = d("2024-06-04T20:00:00"); // 8pm
  const punch = hoursLater(openCheckIn, 13); // 9am next day — overnight checkout
  const { toClose, current } = resolveOpenRecords(
    [{ id: "rec-a", checkInAt: openCheckIn }],
    punch,
    DEFAULT_CAP
  );
  assert(
    "single open record, overnight checkout within cap: current = that record",
    current === "rec-a" && toClose.length === 0
  );
}

// Single open record, stale → auto-closed, no current — falls through to a
// new check-in, and nothing is left to misroute a later punch.
{
  const openCheckIn = CHECK_IN;
  const punch = hoursLater(openCheckIn, 20); // past the 14h cap
  const { toClose, current } = resolveOpenRecords(
    [{ id: "rec-a", checkInAt: openCheckIn }],
    punch,
    DEFAULT_CAP
  );
  assert(
    "single stale open record: auto-closed, current = null (becomes new check-in)",
    current === null && toClose.length === 1 && toClose[0] === "rec-a"
  );

  // Simulate the worker's NEXT punch: rec-a is no longer "present" (it was
  // just auto-closed), so it would never be re-fetched as open again — the
  // next call sees an empty open-record set and is not misrouted.
  const next = resolveOpenRecords([], hoursLater(punch, 1), DEFAULT_CAP);
  assert(
    "worker's next punch after auto-close sees no open records (not misrouted)",
    next.current === null && next.toClose.length === 0
  );
}

// Two open records: an old abandoned one (stale) plus today's genuine one
// (not stale) — this is the exact Step-24-regression scenario. The punch
// must close the MOST RECENT record, never the old one, regardless of which
// order the two records happen to come back from the database in.
{
  const oldAbandoned = d("2024-05-20T05:47:00"); // ~2 weeks old
  const todaysOpen = d("2024-06-04T13:13:00");
  const punch = hoursLater(todaysOpen, 8); // today's real checkout

  const forward = resolveOpenRecords(
    [
      { id: "old-record", checkInAt: oldAbandoned },
      { id: "new-record", checkInAt: todaysOpen },
    ],
    punch,
    DEFAULT_CAP
  );
  assert(
    "two open records (old first): punch closes the most recent, old one auto-closed",
    forward.current === "new-record" &&
      forward.toClose.length === 1 &&
      forward.toClose[0] === "old-record"
  );

  const reversed = resolveOpenRecords(
    [
      { id: "new-record", checkInAt: todaysOpen },
      { id: "old-record", checkInAt: oldAbandoned },
    ],
    punch,
    DEFAULT_CAP
  );
  assert(
    "same result regardless of database row order (deterministic, not arbitrary)",
    reversed.current === "new-record" &&
      reversed.toClose.length === 1 &&
      reversed.toClose[0] === "old-record"
  );
}

// Two open records, BOTH still within the cap (pathological edge case) — the
// most recent is picked as current; the older, still-plausible one is left
// alone rather than being incorrectly fabricated as "incomplete".
{
  const a = d("2024-06-04T08:00:00");
  const b = d("2024-06-04T09:00:00");
  const punch = hoursLater(b, 2);
  const { toClose, current } = resolveOpenRecords(
    [
      { id: "rec-a", checkInAt: a },
      { id: "rec-b", checkInAt: b },
    ],
    punch,
    DEFAULT_CAP
  );
  assert(
    "two non-stale open records: most recent wins, older one left untouched",
    current === "rec-b" && toClose.length === 0
  );
}

console.log("\n── findDuplicateRecord (Step 27 duplicate detection) ──");

// A resent check-in punch matches an existing record's checkInAt, even
// though that worker currently has multiple open records — duplicate
// detection must not depend on which one findOpenRecords() would return.
{
  const checkInTime = d("2024-06-04T13:13:00");
  const records = [
    { id: "old-stale-open", checkInAt: d("2024-05-20T05:47:00"), checkOutAt: null },
    { id: "todays-open", checkInAt: checkInTime, checkOutAt: null },
  ];
  const match = findDuplicateRecord(records, checkInTime);
  assert(
    "resent check-in is recognised as a duplicate even with multiple open records",
    match === "todays-open"
  );
}

// A resent checkout punch matches an existing (already-closed) record's
// checkOutAt.
{
  const checkOutTime = d("2024-06-04T21:00:00");
  const records = [
    { id: "closed-record", checkInAt: d("2024-06-04T13:00:00"), checkOutAt: checkOutTime },
  ];
  assert(
    "resent checkout is recognised as a duplicate",
    findDuplicateRecord(records, checkOutTime) === "closed-record"
  );
}

// An auto-closed "incomplete" record's checkInAt still counts for duplicate
// matching — its status doesn't exempt it from being recognised as a resend.
{
  const checkInTime = d("2024-06-04T05:47:00");
  const records = [
    { id: "incomplete-record", checkInAt: checkInTime, checkOutAt: null },
  ];
  assert(
    "an auto-closed incomplete record's check-in still matches on resend",
    findDuplicateRecord(records, checkInTime) === "incomplete-record"
  );
}

// A genuinely new punch — no timestamp collision — is not a duplicate.
{
  const records = [
    { id: "rec-a", checkInAt: d("2024-06-04T08:00:00"), checkOutAt: d("2024-06-04T16:00:00") },
  ];
  assert(
    "a genuinely new punch with no timestamp match is not a duplicate",
    findDuplicateRecord(records, d("2024-06-05T08:00:00")) === null
  );
}

console.log("\n" + "─".repeat(48));
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log("─".repeat(48));

if (failed > 0) {
  process.exitCode = 1;
}
