import type { Role } from "./roles";

/**
 * Step 25: the single source of truth for "can this role write". Used by
 * the Workers/Roster/Payroll page-level redirects and by the
 * correctAttendance/markAbsent/markLeave, setDayStatus,
 * setShiftOverride/clearShiftOverride, and createWorker/updateWorker/
 * setWorkerStatus server actions' requireXAccess() helpers. Admin and
 * supervisor may write; viewer is strictly read-only.
 */
export function canWrite(role: Role): boolean {
  return role === "admin" || role === "supervisor";
}

/**
 * Supervisor and viewer both need a terminal (+ optional department) scope
 * recorded in access_scopes; admin doesn't (sees everything).
 */
export function roleNeedsScope(role: Role): boolean {
  return role === "supervisor" || role === "viewer";
}

/** True if this edit would demote the acting admin's own account. */
export function wouldSelfDemote(
  currentUserId: string,
  targetUserId: string,
  newRole: Role
): boolean {
  return currentUserId === targetUserId && newRole !== "admin";
}
