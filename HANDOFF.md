# Handoff Summary

## What was built and is confirmed working

### Step 1 — Project Scaffold ✓
### Step 2 — Database Schema + Migration ✓
### Step 3 — Auth: Login + Role Protection ✓
### Step 4 — Terminals & Departments CRUD ✓
### Step 5 — Shifts CRUD ✓
### Step 6 — Attendance Engine (Pure Functions, 52/52 tests) ✓
### Step 7 — Workers CRUD + R2 Photo Upload ✓
### Step 8 — Daily Roster ✓

- `/dashboard/roster` — date navigator (prev/next/today + date input) + terminal tabs
- Worker list shows every active worker with their scheduled shift for the selected date
- Inline shift selector per row — auto-saves on change (no save button needed)
- Optimistic UI: row updates immediately, reverts on error
- "Override" (amber) badge when a worker has a non-default shift; "Default" badge otherwise
- Amber banner at top of table when any overrides exist for the date
- Supervisor scope enforced: supervisors only see their terminal/department workers
- upsert via `onConflictDoUpdate` on (worker_id, work_date) unique constraint

### Step 9 — Kiosk Screen ✓

- `/kiosk` — terminal selection landing page
- `/kiosk?terminal=<id>` — full-screen dark PWA, tablet-optimised
- Worker photo grid (3–6 columns responsive) with search by name or employee code
- Green "In" badge / blue "Done" badge on worker tiles that update without page reload
- PIN pad overlay: large circular buttons, 4-dot indicator, auto-submits on 4th digit
- Camera overlay: 3-second countdown, auto-captures JPEG frame (mirrored preview), skips gracefully if no camera or permission denied
- Photo sent as base64 in attend API body; decoded server-side and uploaded to R2 at `kiosk/{date}/{workerId}-{ts}.jpg`
- PIN verified server-side with `bcryptjs.compare()` against stored `pinHash`
- Shift resolved: `shift_assignments` override first, then worker's `defaultShiftId`
- Check-in path: inserts `attendance_records` row with `computeLate()` flags; `checkoutMissing: false`
- Check-out path: updates existing row with `computeAllFlags()` (late + early leave + overtime + workedMinutes)
- Already-complete guard: returns 409 if both `checkInAt` and `checkOutAt` already set
- Success screen: big green/blue tick, worker name, formatted time — auto-resets after 3 seconds
- Error screen: red X, message, "Try Again" restarts from camera step
- Live clock in header (HH:MM:SS + day/date) rendered client-side to avoid hydration mismatch
- PWA manifest at `/public/manifest.json` — `display: fullscreen`, `orientation: landscape`
- `/kiosk` and `/api/kiosk/*` added to middleware PUBLIC_PATHS (no login required)
- Build: 15 routes, compiles cleanly

### Step 10 — Attendance Management Dashboard ✓

- `/dashboard/attendance` — new page, "Attendance" link added to sidebar between Roster and Reports
- Date navigator + terminal tabs (same pattern as Roster)
- Server-side data load: workers + shift_assignments + shifts + attendance_records all joined per date
- `checkoutMissing` re-evaluated live on every page load against current server time (not stored stale value)
- Summary bar: total · present · absent · leave · no record · late · missing checkout counts
- Table columns: Code, Name, Dept, Shift (name + HH:MM–HH:MM), Check-in, Check-out, Status, Worked, Actions
- Check-in cell: shows formatted local time + "+Xm late" amber note when `isLate`
- Check-out cell: shows time + early-leave / overtime annotations, or orange ⚠ Missing when `checkoutMissing`
- Status badge: Present (green) / Absent (red) / Leave (blue) / No record (grey)
- Row tinting: orange tint for missing checkout, red tint for absent, blue tint for leave
- **Edit dialog**: time inputs (HH:MM 24h) pre-filled from existing record; saves corrected ISO timestamps; server recomputes all flags via `computeAllFlags()`; handles create-new-record if no row exists yet
- **Mark Absent**: one-click, clears all timestamps and flags, sets status = "absent"
- **Mark Leave**: opens dialog for optional reason text, clears timestamps, sets status = "leave"
- **Audit log**: every correction writes a row to `audit_log` with `actorUserId`, `action` (correct_times / create_record / mark_absent / mark_leave), `entityType = "attendance_record"`, `entityId`, `beforeJson`, `afterJson`
- Supervisor scope enforced on all three server actions
- Build: 17 routes, compiles cleanly

---

## Decisions made (all steps)

- Date stored and navigated as YYYY-MM-DD (UTC); local timezone offset handled client-side
- Selecting "↩ Default: [shift]" in the Roster dropdown clears the override (deletes the row)
- Workers ordered by department name then full name for easier scanning
- Date display uses a fixed month-name array (no `toLocaleDateString`) — avoids hydration mismatch
- Kiosk is fully public (no NextAuth session); security relies on per-worker 4-digit PIN
- Kiosk photo upload: base64 in JSON body (not a separate multipart upload); non-fatal if R2 fails
- Camera auto-captures at 480×360 JPEG 0.72 quality (~40–60 KB) to keep payload small
- Canvas draw uses `ctx.scale(-1,1)` to mirror the frame so stored photo matches natural orientation
- Midnight-crossing shifts: checkout is stored on the next calendar day; kiosk/attendance engine handles via `crossesMidnight` flag on the shift row
- Manual time corrections: time input values are local time in the browser; `new Date(y, mo-1, d, h, m)` converts to UTC ISO before sending to server — consistent with how kiosk stores timestamps
- `Set` spread (`[...set]`) avoided in favor of `Array.from(set)` due to TypeScript compile target
- `checkoutMissing` is not relied on as a stored truth — always recomputed live on the attendance page

---

### Step 11 — Reports ✓

- `/dashboard/reports` — monthly summary, one row per worker
- `/dashboard/reports/[workerId]` — day-by-day detail for one worker in the selected month
- Month navigator (prev/next/this month) + terminal tabs + department filter dropdown
- Summary table columns: Code, Name, Dept, Present, Absent, Leave, No Record, Total Hours, Late
- Grand totals row at the bottom of the summary table
- "No Record" computed as `max(0, daysElapsed - recordCount)` per worker; `daysElapsed` = today's date for current month, or all days for past months, 0 for future months
- Worker name in summary is a clickable link → detail page; back link preserves month + terminal context
- **Download CSV**: client-side, no server round-trip; includes meta row, header, data rows, blank line, totals row; filename `attendance-{month}.csv`
- Detail page summary chips: Present · Absent · Leave · Total Hours · Late (hidden if 0)
- Detail table: one row per calendar day; future days shown at 40% opacity; today's date highlighted in primary colour
- Notes column: "Late +Xm · Early -Xm · OT +Xm · Missing checkout · {leave reason}" joined with " · "
- Supervisor scope enforced on both pages (redirect to `/dashboard/reports` if not allowed)
- Build: 18 routes, compiles cleanly

---

## Decisions made (all steps)

- Date stored and navigated as YYYY-MM-DD (UTC); local timezone offset handled client-side
- Selecting "↩ Default: [shift]" in the Roster dropdown clears the override (deletes the row)
- Workers ordered by department name then full name for easier scanning
- Date display uses a fixed month-name array (no `toLocaleDateString`) — avoids hydration mismatch
- Kiosk is fully public (no NextAuth session); security relies on per-worker 4-digit PIN
- Kiosk photo upload: base64 in JSON body (not a separate multipart upload); non-fatal if R2 fails
- Camera auto-captures at 480×360 JPEG 0.72 quality (~40–60 KB) to keep payload small
- Canvas draw uses `ctx.scale(-1,1)` to mirror the frame so stored photo matches natural orientation
- Midnight-crossing shifts: checkout is stored on the next calendar day; kiosk/attendance engine handles via `crossesMidnight` flag on the shift row
- Manual time corrections: time input values are local time in the browser; `new Date(y, mo-1, d, h, m)` converts to UTC ISO before sending to server — consistent with how kiosk stores timestamps
- `Set` spread (`[...set]`) avoided in favor of `Array.from(set)` due to TypeScript compile target
- `checkoutMissing` is not relied on as a stored truth — always recomputed live on the attendance page
- Reports "No Record" count uses `daysElapsed` not total days in month, so current-month reports show accurate gaps rather than inflated future-day gaps

---

### Step 12 — Audit Log Viewer ✓

- `/dashboard/audit` — admin-only (non-admins redirect to `/dashboard`)
- "Audit Log" link added to sidebar between Reports and Settings (admin-only, `ScrollText` icon)
- Four period preset buttons: Today / Last 7 days / Last 30 days (default) / Last 90 days — each is a URL param that triggers a fresh server load
- Data loaded via 4-table join: `audit_log → users` (actor name/email) + `audit_log → attendance_records → workers` (worker name/code, work date)
- Capped at 200 entries per period; amber notice shown if the period contains more
- Two client-side filters (instant, no reload): action dropdown + name search box
- Entry count shown ("X of Y" when filters are active)
- Table columns: Time (time + date stacked), Actor (name + email), Action (coloured badge), Worker (name + code stacked), Work date, View button
- Action badge colours: Corrected times = blue, Created record = green, Marked absent = red, Marked leave = purple
- **Diff dialog** (click "View →"): shows meta (action, worker, work date, actor, timestamp) then a field-by-field Before / After table; changed rows highlighted amber; ISO timestamps converted to local time; null values shown as "—"; boolean fields shown as "Yes / No"; minute fields shown as "Xm"
- Fields rendered in logical order (status, check-in, check-out, leave reason, then flag fields)
- Build: 19 routes, compiles cleanly

---

## Decisions made (all steps)

- Date stored and navigated as YYYY-MM-DD (UTC); local timezone offset handled client-side
- Selecting "↩ Default: [shift]" in the Roster dropdown clears the override (deletes the row)
- Workers ordered by department name then full name for easier scanning
- Date display uses a fixed month-name array (no `toLocaleDateString`) — avoids hydration mismatch
- Kiosk is fully public (no NextAuth session); security relies on per-worker 4-digit PIN
- Kiosk photo upload: base64 in JSON body (not a separate multipart upload); non-fatal if R2 fails
- Camera auto-captures at 480×360 JPEG 0.72 quality (~40–60 KB) to keep payload small
- Canvas draw uses `ctx.scale(-1,1)` to mirror the frame so stored photo matches natural orientation
- Midnight-crossing shifts: checkout is stored on the next calendar day; kiosk/attendance engine handles via `crossesMidnight` flag on the shift row
- Manual time corrections: time input values are local time in the browser; `new Date(y, mo-1, d, h, m)` converts to UTC ISO before sending to server — consistent with how kiosk stores timestamps
- `Set` spread (`[...set]`) avoided in favor of `Array.from(set)` due to TypeScript compile target
- `checkoutMissing` is not relied on as a stored truth — always recomputed live on the attendance page
- Reports "No Record" count uses `daysElapsed` not total days in month, so current-month reports show accurate gaps rather than inflated future-day gaps
- Audit log join uses `eq(auditLog.entityId, attendanceRecords.id)` without a FK constraint — intentional so the log schema remains generic for future entity types
- Audit log capped at 200 per period to keep page fast; period filter drives the DB query, action filter and search are client-side

---

### Step 13 — Kiosk Offline Buffer ✓

- `src/lib/kiosk-idb.ts` — new IndexedDB module; two stores:
  - `worker_cache` keyed by `terminalId`; stores worker list + the date it was cached; read returns `null` if the stored date differs from today (auto-invalidates at midnight)
  - `punch_queue` auto-increment; stores `{ workerId, pin, photoBase64, workDate, queuedAt, terminalId }`
- **Worker cache**: SSR-provided workers saved to IDB on mount; a 5-minute interval re-fetches from `/api/kiosk/workers` while online and updates both React state + IDB
- **Punch queue**: if `navigator.onLine === false` before the fetch, or if `fetch` throws a network error, the punch is stored in IDB instead of being dropped; worker tile gets an optimistic update immediately
- **Amber "Queued" success screen**: shown instead of green/blue when a punch is queued offline — "Check-In Queued / Check-Out Queued" + "Will sync when back online"
- **Auto-sync on reconnect**: `window.addEventListener('online', ...)` triggers `syncQueue`; drains queue in insertion order; removes successes and permanent 4xx failures; leaves 5xx for next cycle; stops on further network errors
- **Offline indicator dot** in kiosk header: green when online; amber + pulsing when offline; shows `"Offline · X queued"` count when punches are pending
- **Double-punch bug fixed**: React 18 Strict Mode double-invokes `useEffect([], [])` in dev, causing `getUserMedia`'s `.catch` to fire twice and call `onCapture(null)` twice. Fixed by: (1) adding `capturedRef` guard to the `.catch` handler in `CameraCapture` (same guard already used in the countdown path); (2) adding a `processingRef` synchronous lock at the top of `onPhotoCapture` — immune to React's batched state updates, reset in `onPinComplete` at the start of each new camera session
- Build: 19 routes, compiles cleanly

---

## Decisions made (all steps)

- Date stored and navigated as YYYY-MM-DD (UTC); local timezone offset handled client-side
- Selecting "↩ Default: [shift]" in the Roster dropdown clears the override (deletes the row)
- Workers ordered by department name then full name for easier scanning
- Date display uses a fixed month-name array (no `toLocaleDateString`) — avoids hydration mismatch
- Kiosk is fully public (no NextAuth session); security relies on per-worker 4-digit PIN
- Kiosk photo upload: base64 in JSON body (not a separate multipart upload); non-fatal if R2 fails
- Camera auto-captures at 480×360 JPEG 0.72 quality (~40–60 KB) to keep payload small
- Canvas draw uses `ctx.scale(-1,1)` to mirror the frame so stored photo matches natural orientation
- Midnight-crossing shifts: checkout is stored on the next calendar day; kiosk/attendance engine handles via `crossesMidnight` flag on the shift row
- Manual time corrections: time input values are local time in the browser; `new Date(y, mo-1, d, h, m)` converts to UTC ISO before sending to server — consistent with how kiosk stores timestamps
- `Set` spread (`[...set]`) avoided in favor of `Array.from(set)` due to TypeScript compile target
- `checkoutMissing` is not relied on as a stored truth — always recomputed live on the attendance page
- Reports "No Record" count uses `daysElapsed` not total days in month, so current-month reports show accurate gaps rather than inflated future-day gaps
- Audit log join uses `eq(auditLog.entityId, attendanceRecords.id)` without a FK constraint — intentional so the log schema remains generic for future entity types
- Audit log capped at 200 per period to keep page fast; period filter drives the DB query, action filter and search are client-side
- Offline punch queue stores the plain 4-digit PIN in IDB (needed so the server can bcrypt-verify on sync); acceptable because IDB is origin-scoped and the kiosk is a controlled device
- Worker cache in IDB is invalidated by date mismatch (not TTL) so midnight rollovers always pull a fresh list
- `processingRef` (useRef) used as the double-invocation lock in `onPhotoCapture` rather than a state variable — refs are synchronous and bypass React's batched update queue
- User scope stored in separate `supervisorScopes` table (not on `users` directly); each supervisor treated as having one scope in the UI (first row wins on read; all rows replaced on save)
- `AlertDialogAction` (Radix) closes the dialog immediately on click — used a plain `Button` for async confirm actions to keep the dialog open until the server action resolves
- Deactivated users are blocked at login (`isActive` check in `authorize` in `src/auth.ts`); existing JWT sessions remain valid until expiry (acceptable for a controlled-device deployment)

---

### Step 15 — User & Settings Management ✓ (confirmed working in browser)

- `/dashboard/users` — admin-only (non-admins redirect to `/dashboard`)
- "Users" link added to sidebar between Audit Log and Settings (`UserCog` icon, `adminOnly: true`)
- `isActive boolean not null default true` added to `users` table in schema; `src/auth.ts` updated to block inactive users at login
- List all users: Name, Email, Role (purple/blue badge), Scope (terminal / dept or "All terminals" for admins), Created date, Active/Inactive badge
- Inactive rows shown at 60% opacity with slate background; current user row labeled "(you)"
- **Create user** dialog: name, email, password, role selector; scope fields (terminal + optional department) shown only when role = supervisor; email normalised to lowercase; password hashed with bcryptjs (12 rounds)
- **Edit user** dialog: change name, email, role, scope; no password field; scope row replaced on save (delete + insert)
- **Reset password**: separate dialog — admin sets new password; bcrypt-hashed and saved; no hashes in audit log
- **Deactivate / Reactivate**: AlertDialog confirmation; deactivate button disabled for current user (self-lockout in UI + server)
- **Self-lockout protection**: server blocks deactivating or demoting your own account with readable error
- **Last-admin protection**: server blocks deactivating or demoting the last active admin ("Cannot remove the last active admin")
- **Email uniqueness**: DB constraint caught and returned as "A user with that email already exists"
- **Audit log**: `create_user / edit_user / reset_password / deactivate_user / reactivate_user`; `entityType = "user"`; password hashes never included in before/after JSON
- All mutations admin-gated server-side
- Build: 20 routes, compiles cleanly

---

### Step 14 — Vercel Deployment ✓

- App live at **https://subhan-attendance-app.vercel.app**
- GitHub repo: https://github.com/Bakr1097/subhan-attendance-app (branch: main)
- Login, dashboard, and kiosk confirmed working in production
- Environment variables set in Vercel dashboard; Neon DB migration run; first admin user seeded

---

### Step 16 — Biometric Punch Ingestion, Part 1 (app side) ✓

Builds the endpoint that will receive punches from a ZKTeco MB460 terminal. The bridge program that reads the device over LAN and POSTs to this endpoint is a separate, later step (Part 2) — not built here.

- `workers.deviceUserId` — new nullable, unique `text` column mapping a worker to their enrolled User ID on the biometric device (migration `drizzle/0001_chilly_molly_hayes.sql`)
- Worker create/edit form: "Biometric Device User ID" optional text field with helper text; saved through the existing `createWorker` / `updateWorker` actions; duplicate device IDs surface as a friendly "already assigned to another worker" error (same pattern as the Users page email-uniqueness check)
- **`POST /api/biometric/punch`** — new public (no session) endpoint
  - Auth: `x-bridge-secret` header must match `BRIDGE_API_SECRET`; 401 if missing/wrong
  - Body: a single `{ deviceUserId, timestamp }` punch or an array of them; each is processed independently so one bad punch never fails the batch
  - Device-reported check-in/check-out status is ignored entirely — direction is always derived from the DB, exactly like the Step 9 kiosk: no record or no `checkInAt` → check-in (`computeLate`); `checkInAt` set + `checkOutAt` null → check-out (`computeAllFlags`); both set → `already-complete`
  - Idempotency: if the punch's timestamp exactly matches the record's stored `checkInAt` or `checkOutAt`, it's skipped as `duplicate` (the bridge may resend punches) — checked before the check-in/check-out classification so a resent check-in punch isn't mistaken for a checkout
  - Unmatched `deviceUserId`s (no worker found) are skipped and collected, never fail the batch
  - Returns `{ processed, checkedIn, checkedOut, duplicates, alreadyComplete, unmatched }`
- **`src/lib/shift-resolution.ts`** — new shared helper (`resolveShiftForWorker`) extracted from the near-identical shift-override-then-default lookup that previously lived separately in the kiosk attend route and the attendance dashboard's `correctAttendance` action; both now import it, plus the new punch endpoint
- Work-date derivation for a bare timestamp (no client to say "today" the way the kiosk does): the punch's UTC calendar date is used as-is, UNLESS the worker's **default** shift has `crossesMidnight = true`, in which case we first check whether the worker has a still-open record (checked in, not checked out) on the previous calendar day — if so, the punch is treated as that day's checkout instead of a new check-in on the new day. This only looks at the default shift for the date determination step (not a per-day override), since a shift_assignments override lookup itself requires already knowing the work date
- `/api/biometric/*` added to middleware `PUBLIC_PATHS` — same reasoning as the kiosk: security is the shared secret, not a session
- `BRIDGE_API_SECRET` added to `.env.local`; **the same value must be set in Vercel project env vars**: `kOxyH+zmjOeydrjpsz1v7MATRrK1R5S1NlKaDJCvRxY=`
- Build: 21 routes, compiles cleanly
- Note: while generating this migration, `drizzle-kit generate` also picked up `users.is_active` (added to `schema.ts` in Step 15 but never captured in a tracked migration — it was applied to the live DB out of band at the time). That line was removed from `0001_chilly_molly_hayes.sql` since the column already exists in the live database; only the `device_user_id` column is in this migration

---

## All 16 steps complete. App is in production. Part 2 (LAN bridge program) is a separate future step.
