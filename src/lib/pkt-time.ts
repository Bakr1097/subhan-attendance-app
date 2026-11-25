/**
 * Pakistan-local calendar helpers (Step 30). Dependency-free so they can be
 * unit-tested without the database client.
 *
 * Pakistan is UTC+5 year-round (no DST) — same constant as attendance.ts's
 * buildUtcDate() and payroll-report.ts's pktToUtc().
 */
const PKT_OFFSET_MS = 5 * 60 * 60_000;

/**
 * The Pakistan-local calendar date (YYYY-MM-DD) of a UTC instant.
 *
 * The biometric bridge only sends a raw timestamp, so the punch route has to
 * derive workDate itself. Using the UTC date filed every punch between
 * 00:00 and 04:59 PKT under the previous day.
 */
export function pktDateStr(instant: Date): string {
  return new Date(instant.getTime() + PKT_OFFSET_MS).toISOString().slice(0, 10);
}
