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

/**
 * Step 27: before Step 24, a worker could never have more than one open
 * (checked-in, not checked-out) record — any punch always closed whatever
 * was open, so a single arbitrary "find one open record" lookup was safe.
 * Step 24 broke that invariant on purpose (a stale record is left open for
 * manual review instead of being closed), which means a worker can now have
 * several simultaneously-open records — and nothing was picking among them
 * deterministically.
 *
 * Given ALL of a worker's currently-open records and an incoming punch, this
 * decides, in one pass:
 *  - which are too old to plausibly be this punch's checkout (`toClose`) —
 *    every one of these must be auto-closed as "incomplete" so it can never
 *    be selected again by a future punch, cleaning up backlog in one shot
 *    rather than one record per future punch.
 *  - which single record — the most recent survivor — is the worker's
 *    actual current shift this punch should close (`current`, or null if
 *    every open record turned out to be stale, meaning this punch is really
 *    a new check-in).
 */
export interface OpenRecordRef {
  id: string;
  checkInAt: Date;
}

export interface OpenRecordResolution {
  toClose: string[];
  current: string | null;
}

export function resolveOpenRecords(
  openRecords: OpenRecordRef[],
  punchTimestamp: Date,
  maxOpenShiftHours: number
): OpenRecordResolution {
  const sorted = [...openRecords].sort(
    (a, b) => b.checkInAt.getTime() - a.checkInAt.getTime()
  );

  const toClose: string[] = [];
  let current: string | null = null;

  for (const rec of sorted) {
    if (isOpenRecordStale(rec.checkInAt, punchTimestamp, maxOpenShiftHours)) {
      toClose.push(rec.id);
    } else if (current === null) {
      current = rec.id;
    }
  }

  return { toClose, current };
}

/**
 * Step 27: duplicate/idempotency detection must not depend on which open
 * record a previous lookup happened to return — it now checks a punch
 * against ALL of a worker's records (open, closed, or auto-closed
 * "incomplete") for an exact timestamp match on either checkInAt or
 * checkOutAt, so a resent punch (e.g. the bridge retrying a chunk after a
 * partial batch failure — Step 20) is recognised no matter how many open
 * records exist or which one is "current".
 */
export interface DuplicateCandidateRef {
  id: string;
  checkInAt: Date | null;
  checkOutAt: Date | null;
}

export function findDuplicateRecord(
  records: DuplicateCandidateRef[],
  punchTimestamp: Date
): string | null {
  const match = records.find(
    (r) =>
      (r.checkInAt && r.checkInAt.getTime() === punchTimestamp.getTime()) ||
      (r.checkOutAt && r.checkOutAt.getTime() === punchTimestamp.getTime())
  );
  return match ? match.id : null;
}
