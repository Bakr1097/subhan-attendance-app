/**
 * Pure decision (Step 24), kept in its own dependency-free module so it can
 * be unit-tested without pulling in the database client that
 * punch-resolution.ts (and everything it imports) requires at load time.
 *
 * Is `openCheckInAt` too old for `punchTimestamp` to plausibly be its
 * checkout? Hours strictly greater than `maxOpenShiftHours` are stale —
 * exactly at the cap still counts as a valid checkout.
 */
export function isOpenRecordStale(
  openCheckInAt: Date,
  punchTimestamp: Date,
  maxOpenShiftHours: number
): boolean {
  const hours =
    (punchTimestamp.getTime() - openCheckInAt.getTime()) / (1000 * 60 * 60);
  return hours > maxOpenShiftHours;
}
