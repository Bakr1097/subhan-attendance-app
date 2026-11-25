/**
 * Inline self-checks for pktDateStr() (Step 30).
 * Run with:  npx tsx src/lib/pkt-time.test.ts
 */

import { pktDateStr } from "./pkt-time";

// ---------------------------------------------------------------------------
// Tiny test harness (same shape as attendance.test.ts)
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function eq<T>(label: string, actual: T, expected: T) {
  if (actual === expected) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}  (expected ${expected}, got ${actual})`);
    failed++;
  }
}

/** Helper: build a UTC Date from an ISO-like string at Zulu time. */
function z(iso: string): Date {
  return new Date(iso + ".000Z");
}

console.log("── pktDateStr (bridge punch workDate) ──");

// The bug: 04:30 PKT on Nov 25 is 23:30 UTC on Nov 24 — the UTC date put it
// under the previous day.
eq("04:30 PKT (23:30Z prev day) → same PKT date", pktDateStr(z("2026-11-24T23:30:00")), "2026-11-25");
eq("00:00 PKT exactly (19:00Z prev day) → new PKT date", pktDateStr(z("2026-11-24T19:00:00")), "2026-11-25");
eq("23:59:59 PKT (18:59:59Z) → still that PKT date", pktDateStr(z("2026-11-25T18:59:59")), "2026-11-25");
eq("05:00 PKT (00:00Z) → same date in both zones", pktDateStr(z("2026-11-25T00:00:00")), "2026-11-25");
eq("midday PKT → same date", pktDateStr(z("2026-11-25T07:45:24")), "2026-11-25");
eq("month boundary: 02:00 PKT Dec 1 (21:00Z Nov 30)", pktDateStr(z("2026-11-30T21:00:00")), "2026-12-01");
eq("year boundary: 01:00 PKT Jan 1 (20:00Z Dec 31)", pktDateStr(z("2026-12-31T20:00:00")), "2027-01-01");

console.log("\n" + "─".repeat(48));
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log("─".repeat(48));

if (failed > 0) {
  process.exitCode = 1;
}
