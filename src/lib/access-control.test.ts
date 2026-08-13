/**
 * Inline self-checks for role-based access control (Step 25 — viewer role).
 * Run with:  npx tsx src/lib/access-control.test.ts
 *
 * Pure logic only, no database connection:
 *  - canWrite() / roleNeedsScope() / wouldSelfDemote() are the exact
 *    functions the write-action guards (attendance/payroll/roster/workers
 *    actions.ts) and the page-level redirects (workers/payroll/roster
 *    page.tsx) call — testing them here tests the real enforcement, not a
 *    re-implementation of it.
 *  - NAV_ITEMS is the same data the Sidebar/MobileNav filter on, so
 *    asserting its `roles` arrays here also asserts which pages a viewer
 *    can navigate to at all.
 */

import { canWrite, roleNeedsScope, wouldSelfDemote } from "./access-control";
import { NAV_ITEMS } from "@/components/dashboard/nav-items";
import type { Role } from "./roles";

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

// ---------------------------------------------------------------------------
// canWrite() — guards every write action AND the Workers/Roster/Payroll
// page-level redirects. A single failing case here means a viewer could
// write, or a supervisor/admin lost access they should still have.
// ---------------------------------------------------------------------------

console.log("── canWrite (write-action & write-page gate) ──");

assert("admin can write", canWrite("admin") === true);
assert("supervisor can write (unchanged from before Step 25)", canWrite("supervisor") === true);
assert("viewer cannot write — denied on every write action", canWrite("viewer") === false);

// ---------------------------------------------------------------------------
// roleNeedsScope() — who needs a terminal/department scope row
// ---------------------------------------------------------------------------

console.log("\n── roleNeedsScope (terminal/department scope requirement) ──");

assert("admin does not need a scope", roleNeedsScope("admin") === false);
assert("supervisor needs a scope (unchanged)", roleNeedsScope("supervisor") === true);
assert("viewer needs a scope, same as supervisor", roleNeedsScope("viewer") === true);

// ---------------------------------------------------------------------------
// wouldSelfDemote() — self-lockout protection, now covering the viewer role
// ---------------------------------------------------------------------------

console.log("\n── wouldSelfDemote (self-lockout protection) ──");

const ME = "user-1";
const OTHER = "user-2";

assert(
  "admin demoting themselves to viewer is blocked",
  wouldSelfDemote(ME, ME, "viewer") === true
);
assert(
  "admin demoting themselves to supervisor is blocked (pre-existing case)",
  wouldSelfDemote(ME, ME, "supervisor") === true
);
assert(
  "admin editing their own account but keeping admin is allowed",
  wouldSelfDemote(ME, ME, "admin") === false
);
assert(
  "admin demoting a DIFFERENT admin to viewer is allowed (not self)",
  wouldSelfDemote(ME, OTHER, "viewer") === false
);

// ---------------------------------------------------------------------------
// NAV_ITEMS — same data driving Sidebar/MobileNav; asserting it here also
// asserts which pages a viewer is redirected away from vs. allowed to open.
// ---------------------------------------------------------------------------

console.log("\n── NAV_ITEMS (viewer page reachability) ──");

const VIEWER_ALLOWED = new Set([
  "/dashboard",
  "/dashboard/attendance",
  "/dashboard/reports",
]);
const ADMIN_ONLY_PATHS = new Set([
  "/dashboard/terminals",
  "/dashboard/departments",
  "/dashboard/shifts",
  "/dashboard/audit",
  "/dashboard/users",
  "/dashboard/settings",
]);
const WRITE_PAGES = new Set([
  "/dashboard/workers",
  "/dashboard/roster",
  "/dashboard/payroll",
]);

assert(
  "every nav item is classified into exactly one bucket (no gaps in the test itself)",
  NAV_ITEMS.length === VIEWER_ALLOWED.size + ADMIN_ONLY_PATHS.size + WRITE_PAGES.size
);

for (const item of NAV_ITEMS) {
  const roles = item.roles as Role[];
  if (VIEWER_ALLOWED.has(item.href)) {
    assert(`${item.label}: viewer, supervisor, and admin can all see it`, roles.includes("viewer") && roles.includes("supervisor") && roles.includes("admin"));
  } else if (ADMIN_ONLY_PATHS.has(item.href)) {
    assert(`${item.label}: only admin can see it — viewer redirected`, roles.length === 1 && roles.includes("admin"));
    assert(`${item.label}: supervisor also redirected (admin-only, unchanged)`, !roles.includes("supervisor"));
  } else if (WRITE_PAGES.has(item.href)) {
    assert(`${item.label}: viewer redirected away (write page)`, !roles.includes("viewer"));
    assert(`${item.label}: supervisor still allowed (unchanged from before Step 25)`, roles.includes("supervisor"));
    assert(`${item.label}: admin still allowed (unchanged)`, roles.includes("admin"));
  } else {
    assert(`${item.label}: unexpected href not covered by this test`, false);
  }
}

console.log("\n" + "─".repeat(48));
console.log(`  ${passed} passed  |  ${failed} failed`);
console.log("─".repeat(48));

if (failed > 0) {
  process.exitCode = 1;
}
