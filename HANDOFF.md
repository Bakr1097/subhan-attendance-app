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

### Step 16 (Part 2) — ZKTeco MB460 LAN Bridge Program ✓

Self-contained Node.js program in **`zkteco-bridge/`**, separate from the Next.js app (no app files touched). Runs on a PC on the same LAN as the physical terminal; not deployed to Vercel.

- **What it does**: connects to the MB460 over TCP, downloads attendance logs via `node-zklib`, filters out anything already sent (tracked in a local `last-sync.json` checkpoint file), sorts the rest chronologically, and POSTs the batch to `/api/biometric/punch` with the `x-bridge-secret` header
- **Runs once and exits** — no polling loop in the script itself; Windows Task Scheduler is what re-runs it every 5 minutes (setup steps are in `zkteco-bridge/README.md`)
- **Config values** (`zkteco-bridge/config.js`, all hardcoded per the business's fixed setup): device IP `192.168.1.201`, port `4370`, endpoint `https://subhan-attendance-app.vercel.app/api/biometric/punch`, and the same `BRIDGE_API_SECRET` value already set in `.env.local`/Vercel
- **`test-connection.js`**: standalone read-only diagnostic — connects and prints device name, serial number, firmware, enrolled-user count, and attendance-record count; used to confirm LAN reachability before relying on the real sync
- **Chronological ordering matters**: the app decides check-in vs. check-out from what's already stored, so a batch with a checkout appearing before its check-in (out of order) would be misread; `index.js` sorts all new punches by `recordTime` ascending before sending
- **Failure handling**: device unreachable, log-read failure, or a non-OK API response are all caught, logged with a timestamp, and exit with `process.exitCode = 1` — never an unhandled crash/stack trace. `last-sync.json` is only advanced after a confirmed-successful send, so a failed run is safely retried in full on the next scheduled run
- **Windows Task Scheduler requirement**: must be configured on the terminal PC to run `node index.js` (working directory = the `zkteco-bridge` folder) every 5 minutes, "run whether user is logged on or not." Exact click-by-click steps are in the README for a non-technical setup
- **Verified against the real device** during this build: successfully connected to the actual MB460 at `192.168.1.201:4370` from this network, confirmed `getAttendances()` returns `{ deviceUserId: string, recordTime: Date }` exactly as expected, and confirmed `getInfo()` reliably returns enrolled-user/log counts. The raw device-name/serial/firmware reads (`test-connection.js` only, via the protocol's `CMD_OPTIONS_RRQ` opcode — not wrapped by `node-zklib`'s public API) occasionally show a stray trailing character due to a device firmware quirk (uninitialized padding byte after the field's NUL terminator); harmless and informational-only, not used by the real sync path
- Did **not** run a real end-to-end sync against the production API/DB as part of this build (that would have created live attendance data) — the user should run `node index.js` once manually to verify before relying on the scheduled task
- Deps: `node-zklib@^1.3.0` only; plain JavaScript, no TypeScript, no build step

---

### Step 17 — Daily-Wage Payroll ✓

**Pay model (deliberately simple, no hours-based tiers):**
- Each worker is `payType` = `"daily"` (dihari) or `"monthly"` (salaried); default `"daily"`.
- Daily workers earn a full day's wage if they have a check-in for the date (`attendance_records.checkInAt` set) — missing checkout does NOT reduce pay, it's just flagged for review.
- No check-in for the date → absent → Rs 0 for that day.
- An admin/supervisor can manually override a single day to "half day" (half the daily rate) via a toggle on the payroll report — this is a manual decision, never automatic. Monthly workers are excluded from payroll entirely (not tracked here).

**Schema:**
- `workers.payType` — text, `"daily"` / `"monthly"`, not null, default `"daily"`
- `workers.dailyRate` — integer (whole rupees), nullable
- New table `payroll_adjustments` (id, workerId, workDate, dayStatus `"full"`/`"half"`, actorUserId, createdAt/updatedAt), unique on (workerId, workDate); default (no row) = full day
- Migration `drizzle/0002_daily_slayback.sql`, applied to the live Neon DB

**Worker form:** "Pay Type" dropdown (Daily/Monthly) + "Daily Rate (PKR)" number input, shown/enabled only for Daily; wired through the existing `createWorker`/`updateWorker` actions.

**`/dashboard/payroll` — "Daily Payroll":**
- "Payroll" sidebar link between Reports and Audit Log (not admin-only — supervisors get scoped access, same pattern as Attendance)
- Date navigator + terminal tabs, same UX as the Attendance page
- Shows ONLY `payType = "daily"` workers for the selected terminal/date — monthly workers never appear here
- Per-row: Code, Name, Dept, Daily Rate, Present? (Yes/No badge from `checkInAt`), Day Status (Full/Half toggle when present, "Absent" badge when not), Amount Payable
- Missing-checkout workers still count present/full for pay, with an amber "⚠ missing checkout" note (checkoutMissing recomputed live, same `flagMissingCheckout` pattern as the Attendance page)
- Summary bar: total daily workers · present · absent · half-days · **Total Payable** (large, its own callout box) · missing-checkout count
- Download CSV: meta row (date, terminal), header, one row per worker, blank line, total payable row — same client-side pattern as the Reports CSV; filename `payroll-{date}.csv`

**Half-day persistence:** the toggle calls `setDayStatus()` (`src/app/dashboard/payroll/actions.ts`), which upserts `payroll_adjustments` via `onConflictDoUpdate` and writes an `audit_log` row (`action: "payroll_adjust"`, `entityType: "payroll_adjustment"`, before/after `dayStatus`) — same audit pattern as attendance corrections. Note: the audit viewer's worker-name join only covers `entityType = "attendance_record"`, so `payroll_adjust` entries show without a worker name/date in the Audit Log table (existing generic-join limitation, not new); the action itself and its diff data are still fully recorded.

**Dashboard today-strip (`/dashboard`):** a compact bar below the existing 3 stat cards — Present · Absent · Late · Missing checkout across **all terminals the current user can see** (scoped the same way as Attendance/Payroll: full visibility for admins, `supervisorScopes`-filtered for supervisors), plus **Today's Payable** total (admin-only) computed with the same present/half/absent logic as the Payroll page. Reuses `flagMissingCheckout` for live recomputation; no separate client component, just a server-rendered block.

**Verified in a real browser session (logged in as admin via the seeded account):**
- Dashboard Today-strip rendered correctly against live data (1 present, 0 absent, 0 late, 0 missing checkout, Today's Payable Rs 0)
- `/dashboard/payroll` rendered correctly against the 6 existing real daily-pay workers (1 present, 5 absent, Rs 0 amounts since no `dailyRate` has been set yet on real workers) — confirms the present/absent/amount pipeline end-to-end
- Did not exercise the half-day toggle interactively (would require a real browser click — Next.js server actions aren't easily driven via curl) or set a real `dailyRate` on a worker; recommend the user try both once in the browser

- Build: 22 routes, compiles cleanly

---

### Step 18 — Closing-Window Payroll + Terminal-Scoped Supervisor Access ✓

**This supersedes the Step 17 calendar-day payroll model.** Step 17 paid by calendar work-date; that's wrong for this business — wages are settled at a daily closing (default 2:30 PM Pakistan time), not at midnight, and a worker can be paid for two shifts in one closing.

**The model:**
- A closing for date D covers the rolling window **[(D-1) at cutoff, D at cutoff)**, in Pakistan local time (UTC+5, no DST) — this naturally spans the previous day's evening/night shift and the current day's morning shift.
- The operation runs one day behind: today's closing run settles **yesterday's** completed window. The payroll page always spells out the exact window in the header (e.g. "Closing 05 Jul 2026 · covers 04 Jul 2026 2:30 PM → 05 Jul 2026 2:30 PM") so a manager can never mistake which day is being paid.
- `shiftsWorked` = count of that worker's `attendance_records` whose `checkInAt` falls inside the window — queried directly by timestamp range (`gte`/`lt` on `checkInAt`), not by `workDate` string matching. This is how a "double" (2) is detected automatically: it requires two separate qualifying rows, not just one shift with unusual hours.
- Pay = `dailyRate × multiplier`, where multiplier comes from status: absent=0, half=0.5, full=1, double=2. Default status is auto-derived from `shiftsWorked` (0→absent, 1→full, 2+→double) unless a manager has manually overridden it for that (worker, closing date).
- A record with `checkInAt` but no `checkOutAt` still counts toward pay (missing checkout never blocks pay) but surfaces a "⚠ missing checkout" note for review, recomputed live via `flagMissingCheckout` using that record's own stored `resolvedShiftId` (not the worker's current default shift — the shift that was actually resolved at check-in time).

**⚠ Known architectural limit (documented, not fixed — out of scope for a payroll-only step):** `attendance_records` still has the Step 2 unique constraint on `(workerId, workDate)`. A "double" is only correctly counted when the worker's two shift sessions resolve to two *different* `workDate` values (the realistic case described: a night shift that started the day before + the next morning's shift). If a worker's two shifts both resolved to the *same* `workDate` (e.g. two non-midnight-crossing shifts on the same calendar day), the second check-in would collide with the first shift's row via the kiosk/biometric endpoints' `onConflictDoUpdate` upsert rather than creating a second row, and `shiftsWorked` would undercount. Properly supporting arbitrary multi-shift days would require relaxing that unique constraint and reworking the kiosk (`/api/kiosk/attend`) and biometric (`/api/biometric/punch`) check-in/check-out matching logic — a much larger change than this step, deliberately not attempted here.

**New table `app_settings`** (`key` text PK, `value`, `updatedAt`) — simple key/value store for global settings, starting with `payrollCutoffTime` (default `"14:30"`, no row needed until an admin changes it). Helpers in `src/lib/settings.ts` (`getSetting`/`setSetting`/`getPayrollCutoffTime`).

**`/dashboard/settings`** — brand new page (the sidebar link existed since Step 15 but the page itself was never built — confirmed via `find`, it 404'd before this step). Admin-only (redirect + sidebar `adminOnly` now `true`, was incorrectly `false`). Single field: payroll closing time, HH:MM 24h input, validated server-side.

**`payroll_adjustments` re-keyed**: `workDate` column renamed to `closingDate` (real Postgres `RENAME COLUMN`, not drop+add — no data lost; drizzle-kit's generate prompted rename-vs-create and rename was selected). `dayStatus` type widened from `"full" | "half"` to `"full" | "half" | "double" | "absent"`. `setDayStatus()` (`src/app/dashboard/payroll/actions.ts`) now takes 4 statuses; still writes an audit_log row (`action: "payroll_adjust"`) same as Step 17.

**`src/lib/payroll-report.ts`** — new shared module (used by both `/dashboard/payroll` and the dashboard today-strip, so the two never disagree): `computeClosingWindow()`, `computePayrollForWorkers()`, `STATUS_MULTIPLIER`. PKT conversion is a hardcoded UTC+5 offset (Pakistan has no DST), not the server's OS timezone — important since Vercel functions run in UTC.

**`/dashboard/payroll` rebuilt**: date navigator now selects the closing date; window shown prominently in the header; columns are Code/Name/Dept/Daily Rate/Shifts/Status (dropdown: Full/Half/Double/Absent)/Amount/Note; summary bar adds "total shifts paid" (sum of multipliers); CSV filename is now `payroll-closing-{date}.csv` with the window text in the meta row.

**Dashboard today-strip**: Present/Absent/Late/Missing-checkout stay calendar-day based (unchanged, per instruction). "Today's Payable" (admin-only) now calls `computePayrollForWorkers()` with `closingDate = today`, so it matches exactly what `/dashboard/payroll` would show for a closing run today — previously (Step 17) it used the old calendar-day half/full logic, which is now gone.

**Supervisor terminal-level scope — audited, not changed:** grepped every scope-check site (`workers`, `attendance`, `payroll`, `reports` summary + detail, `roster`, kiosk workers route — 13 files) and all of them already correctly expand a terminal-wide `supervisorScopes` row (`departmentId = null`) to every department under that terminal, not just one. The Users management form already defaults new supervisor scopes to "All departments" (empty = terminal-wide) with a specific department as an explicit opt-in, not the default. **The only real gap found** was the Settings sidebar link/page (see above) — fixed as part of building Settings for this step. No other scoping code changes were needed; this was a genuine "verify" task, not a "fix" task.

**Verified in a real logged-in browser session** (via curl + cookie jar) against **live production data** — a real worker (Muhammad Abu Bakr) has `dailyRate = 800` and a real check-in at `2026-07-02T09:07:21Z`. For closing date 2026-07-02 with the default 14:30 cutoff, the computed window was `[2026-07-01T09:30:00Z, 2026-07-02T09:30:00Z)` — displayed correctly on-screen as "covers 01 Jul 2026 2:30 PM → 02 Jul 2026 2:30 PM" — and that check-in correctly fell inside it, producing `shiftsWorked = 1`, status "Full", amount **Rs 800**, matching hand-calculation exactly. Settings, Payroll, and Dashboard pages all returned 200 with correct scoped data. Did not click the Status dropdown interactively (Next.js server actions aren't easily driven via curl) or create a real double-shift scenario to observe `shiftsWorked = 2` firsthand — recommend the user try both once.

- Build: 23 routes, compiles cleanly

---

---

### Step 19 — Multiple Same-Day Attendance Records for Double Shifts ✓

**This completes the double-shift limitation flagged in Step 18.** Step 18's payroll correctly counted `shiftsWorked` by querying `checkInAt` timestamps directly (not `workDate` equality), so it was already double-shift-aware in principle — but `attendance_records` still had a unique `(workerId, workDate)` constraint from Step 2, so a second same-day check-in would collide with the first shift's row instead of creating a second one. This step removes that constraint and rebuilds check-in/check-out around open-record detection instead of per-day upserts.

**Schema:**
- Dropped the unique `(workerId, workDate)` constraint on `attendance_records`; `id` remains the primary key (unchanged, already a surrogate key)
- Added nullable `shiftSequence` integer (1, 2, … per worker per workDate) for human-readable ordering in the UI/reports
- Migration `drizzle/0004_pale_hemingway.sql` includes a manual backfill (`UPDATE ... SET shift_sequence = 1 WHERE shift_sequence IS NULL`) since every existing row was the only shift for its day under the old constraint — verified before/after row counts matched (10 → 10) and all backfilled to 1

**The rule:** a new check-in is only allowed when the worker has no open (checked-in, checkout still null) record; if one exists, the punch closes it instead. Implemented once in **`src/lib/punch-resolution.ts`** (`findOpenRecord`, `resolvePunch`) and used by both `/api/kiosk/attend` and `/api/biometric/punch` — no more `onConflictDoUpdate` on `attendance_records` anywhere.
- The open-record search is NOT scoped to a workDate, which is what correctly closes an overnight shift the next calendar day (Step 6 `crossesMidnight` handling is unaffected — checkout still uses the open record's own `resolvedShiftId`/`workDate` for flag computation, not "today").
- Idempotency preserved for the biometric bridge: a resent punch matching the open record's `checkInAt`, or the worker's most recent record's `checkOutAt`, is reported as `duplicate` instead of being reapplied.
- The old "already complete for the day" 409 guard is gone — it no longer applies (a worker can have a complete shift #1 and an open shift #2 the same day); a closed record is simply never touched again by punches.
- Biometric endpoint's `resolveWorkDate` heuristic (checking the previous day for an open record when the shift crosses midnight) is now redundant and removed — the global open-record search already handles it; new check-ins just use the UTC calendar date of the timestamp, same as before.

**Kiosk UI updated to actually support this:** `WorkerEntry.checkedOut` was removed; `checkedIn` now means "has an open shift right now" (sourced from `/api/kiosk/workers` and the SSR `kiosk/page.tsx` via an open-record query, not "today's single record"). Previously, once a worker checked out the tile stayed marked "Done" for the rest of the day with no way to see they could start another shift — now the tile correctly returns to neutral after checkout, ready for a real second check-in.

**Attendance page (Step 10):** a worker with 2 shifts now renders as 2 rows (keyed by `recordId`), each labelled "Shift 2" etc. when `shiftSequence > 1`. Summary counts (present/absent/leave/no-record) are deduped per distinct worker so a double shift is still one present person; late/missing-checkout stay per-shift (row-level), matching the prompt's instruction. `correctAttendance` now takes an explicit `recordId` (null = create a new record, computing the correct `shiftSequence`) instead of looking up by `(workerId, workDate)`. `markAbsent`/`markLeave` now guard against >1 existing record for the day (ambiguous which to overwrite) and are only exposed in the UI on the "no record yet" placeholder row — a worker with a real shift row is obviously present, not absent.

**Reports (Step 11):** monthly summary's "Present" now counts distinct `workDate`s with a present record (not rows), plus a new "Total Shifts" column/CSV field that counts every present row — so a worker with 20 present days and 3 doubles shows Present=20, Total Shifts=23. Detail page lists every shift on a day as its own row with a "Shift 2" badge, and shows a "Total Shifts" chip only when it differs from Present days.

**Payroll (Step 18):** confirmed via code review + live testing that no changes were needed — `computePayrollForWorkers()` already queries `attendanceRecords` by `checkInAt` timestamp range, not `workDate`, so it was already correctly double-shift-aware.

**Audit log:** unchanged pattern, still per-record — `correctAttendance`/`markAbsent`/`markLeave` all write `entityId` as the specific `attendance_records.id` touched.

**⚠ Important bug found and fixed during this step's testing (unrelated to double shifts, but affects the whole app):** the Neon serverless HTTP driver's queries are plain `fetch()` calls under the hood, and Next.js's fetch Data Cache was silently caching them — indefinitely, and persisted to disk (`.next/cache/fetch-cache`), surviving dev-server restarts. Any query whose SQL text+params repeat across requests (e.g. the kiosk worker list, filtered only by terminal+status with no date parameter) could get stuck serving the exact same stale snapshot forever, never reflecting new data. This was caught because a worker (added well before this session) was silently missing from the kiosk grid; a standalone script running the identical query outside Next.js returned the correct live data, proving the DB and query were fine and the caching layer was at fault. **Fixed in `src/lib/db.ts`** by passing `fetchOptions: { cache: "no-store" }` to `neon()`, and added `export const dynamic = "force-dynamic"` to `src/app/kiosk/page.tsx` (the one route that failed to prerender its no-params fallback shell once fetches could no longer be cached at build time). This is a correctness fix for the live production app, not just this session's testing.

**Verified end-to-end against the live production database** (not just code review): sent two real punches via `/api/biometric/punch` for a worker already checked in/out once today, confirmed a second `attendance_records` row was created with `shiftSequence = 2`; confirmed the Attendance page showed 2 rows with a "Shift 2" badge and the summary counted 1 present (not 2); confirmed Reports showed `present: 1, totalShifts: 2` for the month and the detail page showed both shifts with a "Total Shifts" chip; confirmed the Payroll page correctly split the two shifts across two different closings (since the second shift's check-in happened to fall after the 2:30 PM cutoff) rather than either losing one or double-counting — Rs 800 payable in each of the two closings, matching hand-calculation exactly; confirmed the kiosk grid (after the cache fix) shows the worker with `checkedIn: false` since both shifts are closed.

- Build: 23 routes, compiles cleanly

---

### Step 20 — ZKTeco Bridge: Chunked Sync (Backfill Timeout Fix) ✓

**The bug:** `zkteco-bridge/index.js` sent every pending punch in one single POST to `/api/biometric/punch`. On a first-run backfill with a large backlog (tested with 437 real punches), that one request took long enough that it hit Vercel's serverless function time limit and the fetch failed with `fetch failed` after ~5 minutes — and since `last-sync.json` is only written after a confirmed successful send, the **entire run failed with nothing saved**, so the same 437 punches would be retried (and time out again) on every subsequent scheduled run.

**The fix — same file, `main()` only, nothing else touched:**
- `newRecords` is now split into chunks of 50 and sent as sequential POSTs (same endpoint/headers as before) instead of one big request.
- Per-chunk `processed`/`checkedIn`/`checkedOut`/`duplicates`/`alreadyComplete` counts are accumulated and `unmatched` arrays concatenated, so the final log line is still one combined summary across the whole run — output shape for a normal small run (0–5 punches, 1 chunk) is unchanged.
- If a chunk fails (network error or non-OK HTTP response), it's logged clearly with which chunk number failed, and the loop **continues** to the next chunk rather than aborting the whole run.
- The `last-sync.json` checkpoint only advances through the last **contiguous** run of successful chunks starting from chunk 1 — once any chunk fails, the checkpoint stops advancing even if later chunks go on to succeed. This is deliberate: if a later chunk's timestamp were saved as the checkpoint, the earlier failed chunk's punches would fall before it and never be picked up as "new" again on the next run. Any chunks sent successfully after the failure point are still forwarded to the app (so the data isn't lost/delayed there), but the on-device sync checkpoint doesn't move past the gap — the next scheduled run will simply resend everything from the failed chunk onward, which the app's existing duplicate-detection safely absorbs for anything already processed.
- If every chunk fails, behavior is unchanged from before: `last-sync.json` is left untouched and the process exits with code 1.
- `process.exitCode` is now also set to 1 when *some but not all* chunks fail (previously only all-or-nothing runs set an exit code), so a partial failure is visible to anyone/anything monitoring the scheduled task's exit status, even though the run is allowed to keep going and save what it could.
- Not deployed/run against the real device as part of this fix (would touch production data) — logic verified with `node -c` (syntax) and by reasoning through the chunk-failure/checkpoint-advance cases; recommend the user run `node index.js` once for real (ideally next time there's a backlog) to confirm the timeout is actually gone.

---

### Step 21 — Attendance Page: Client-Side Search & Filters ✓

`/dashboard/attendance` now has three instant client-side controls above the table, same pattern as the Audit Log page's filters (Step 12) — no server round-trip, all filtering happens in React state.

- **Search box** — matches worker name OR employee code, case-insensitive, partial match
- **Status filter dropdown** — All / Present / Absent / Leave / No record / Late / Missing checkout. The last two ("Late", "Missing checkout") check the row-level `isLate`/`checkoutMissing` flags rather than the `status` field, since a present row can independently be late and/or missing checkout
- **Department filter dropdown** — options built from `Array.from(new Set(entries.map(e => e.deptName)))` for the currently loaded terminal/date, so it only ever shows departments actually present
- All three combine with AND logic via a single `useMemo`-derived `filteredEntries` array
- "Showing X of Y workers" count appears next to the filters, only when at least one filter is active (matches the Audit Log page's count-display behavior)
- **Summary bar unchanged**: still computed from the full unfiltered `entries` array (per-distinct-worker present/absent/leave/no-record counts, per-row late/missing-checkout counts) — filters only affect which table rows render, never the totals
- Multi-shift rows (`shiftSequence > 1`) are unaffected by the filter refactor — a name/code search matches every row for that worker since each shift is its own entry in `entries`; status/department filters still apply per-row as before
- No server action changes — `correctAttendance`/`markAbsent`/`markLeave` and supervisor scoping (already enforced server-side before this step) are untouched; row actions operate on `filteredEntries` items exactly as they did on `entries` items

- Build: 23 routes, compiles cleanly (no new routes added — this is a client component change only)

---

### Step 22 — Biometric Sync Health Monitor ✓

Lets an admin see, from inside the app, whether the ZKTeco bridge is actually running and syncing — without checking the terminal PC directly.

**`POST /api/biometric/heartbeat`** — new public endpoint, same `x-bridge-secret` header auth as `/api/biometric/punch`. Body: `{ ranAt, success, recordsSynced, message? }`, all validated server-side (400 on missing/malformed fields, 401 on bad/missing secret). `/api/biometric` is already prefix-matched in middleware `PUBLIC_PATHS`, so no middleware change was needed.

**Storage** — no new table/migration: reuses the existing `app_settings` key/value table (`src/lib/settings.ts`) under one key, `biometricSyncStatus`, whose value is a small JSON blob — "keep it simple, single row" as specced. That blob tracks two things, not just the latest heartbeat verbatim: `ranAt`/`success`/`recordsSynced`/`message` from the most recent run, **and** `lastSuccessAt` — the timestamp of the last run that actually succeeded, carried forward unchanged across failed runs. This distinction is what makes the "bridge may be down" warning possible: without it, a string of failed runs would keep overwriting a single "last time" field and the dashboard couldn't tell "failed 2 minutes ago, was fine before that" from "failed continuously for 3 hours." `recordBiometricHeartbeat()` in `settings.ts` reads the previous row and only advances `lastSuccessAt` when the incoming report says `success: true`.

**`zkteco-bridge/index.js` refactored** (`config.js` gained one new value, `HEARTBEAT_ENDPOINT`): the old `main()` body is now `run()`, returning a plain `{ success, recordsSynced, message }` result at every one of its exit points (device unreachable, log-read failure, no new punches, all-chunks-failed, partial chunk failure, full success) instead of bare `return`/`process.exitCode` side effects only. A new thin `main()` calls `run()` inside try/catch (so even a truly unexpected throw still produces a result), then always calls `sendHeartbeat(result)` — which POSTs to the new endpoint and swallows its own errors (network blip, app briefly down) so a heartbeat failure can never affect the sync's own exit code or crash the process. This satisfies "must not throw or block the main run" exactly.

**`/dashboard` — new "Biometric Sync" card, admin-only** (mirrors how the existing Today-strip/Payable figure is already gated on `isAdmin`): shows last run time as relative text (`formatRelativeTime()` — "3 minutes ago" / "2 hours ago" / "1 day ago", no library, same fixed-array style as other date formatting in this app), a green/red Success/Failed badge for the last run's own outcome, records synced last run, and the run's message in small muted text. Separately, if `lastSuccessAt` is null (never succeeded) or more than 15 minutes old, a red "⚠ Bridge may be down — last successful sync was X ago" banner appears — deliberately independent of whether the *last run specifically* succeeded, so a bridge stuck retrying-and-failing for an hour is flagged even though each individual failure already shows red. If no heartbeat has ever been received (`app_settings` row doesn't exist yet — e.g. bridge not yet redeployed with this change), the card shows a neutral "No sync data yet" message rather than the red warning, since that's an unconfigured state, not a detected outage.

**`zkteco-bridge/README.md`** — added the heartbeat endpoint to the Configuration list and a new "Health monitoring" section explaining the Dashboard card and what to check on the terminal PC if the warning appears.

**Verified locally against the real production Neon database** (dev server pointed at the same `DATABASE_URL` as production, per `.env.local`): confirmed 401 on missing/wrong secret, 400 on a malformed body, 200 + row written on a valid success heartbeat, and confirmed a subsequent *failure* heartbeat correctly preserved the earlier `lastSuccessAt` rather than clobbering it (read back and reasoned through by hand: success-heartbeat's `lastSuccessAt` became its own `ranAt`; the following failure-heartbeat kept that same `lastSuccessAt` unchanged). Confirmed `/dashboard` still correctly redirects an unauthenticated request to `/login` (route/middleware unaffected). **The test heartbeat rows were deleted from the production `app_settings` table after verification** so the live Dashboard shows a clean "No sync data yet" state rather than fake test data until the real bridge (once redeployed to the terminal PC with the updated `index.js`/`config.js`) sends its first real heartbeat. Did not visually confirm the card's rendering in an actual logged-in browser session (no admin credentials available in this session) — recommend the user load `/dashboard` once after redeploying the bridge to confirm the card and, ideally, the 15-minute warning by temporarily pausing the Task Scheduler task.
- Build: 24 routes, compiles cleanly

---

### Step 23 — Mobile-Friendly Layout for 5 Core Pages ✓

Managers use the app on their phones daily, but wide tables on several pages overflowed in portrait and forced rotating to landscape. This step adds a below-`md` stacked-card presentation to each affected table, purely a responsive layer — no logic, data-loading, filtering, or calculation changes, and the desktop (`md:` and up) markup is untouched everywhere.

**Structural finding before the page work could matter — approved by the user before proceeding:** the dashboard `Sidebar` (`src/components/dashboard/sidebar.tsx`) was a fixed `w-60` (240px) column with no mobile handling at all, shared by every dashboard page. On a ~375px phone that leaves ~135px for content — no amount of per-page card work would have been usable with that in place. Fixed by:
- `Sidebar`: now `hidden md:flex` — same markup/behavior at `md:` and up, simply absent from the layout below it.
- New `src/components/dashboard/nav-items.ts` — the nav item list extracted out of `Sidebar` so both it and the new mobile drawer share one source instead of duplicating it.
- New `src/components/dashboard/mobile-nav.tsx` — a slide-out drawer (backdrop + panel, `md:hidden`) with the same nav items; closes on backdrop click, the X button, or tapping a link.
- `TopBar` gained an optional `onMenuClick` prop and a hamburger button (`md:hidden`); header changed from `justify-end` to `justify-between md:justify-end` so the user-menu dropdown stays pinned right at `md:` and up exactly as before, with the hamburger only occupying space below it.
- New `src/components/dashboard/dashboard-shell.tsx` (client component) holds the single `mobileNavOpen` boolean and wires `Sidebar` + `MobileNav` + `TopBar` + the `<main>` together; `src/app/dashboard/layout.tsx` (a server component, can't hold state itself) now just renders `<DashboardShell>{children}</DashboardShell>` instead of assembling the shell inline. `<main>` padding became `p-4 md:p-6` (unchanged at `md:`, tighter on phones).

**Per-page pattern used everywhere:** wrap the existing `<Table>`'s container in `hidden md:block` (byte-for-byte the same JSX as before, just conditionally hidden) and add a sibling `md:hidden` block that maps the same data array into `border rounded-lg p-4` cards — reusing existing sub-components (`RowActions`, `StatusBadge`, `StatusSelect`) directly inside the cards wherever one already existed, rather than re-implementing their logic. Row tinting (orange/red/blue backgrounds for missing-checkout/absent/leave) and shift-sequence badges carry over to the card treatment on every page. Date/month navigators and filter rows got `flex-wrap` (and, on Attendance, `flex-col sm:flex-row` + full-width inputs) added so they wrap/stack instead of overflowing; this is unrelated to the table-to-card work but was called out explicitly in the spec ("date navigators... must stay usable on mobile").

- **`/dashboard/attendance`** (`attendance-client.tsx`): search/status/department filter row now stacks full-width below `sm:`; mobile cards show name+shift-sequence badge, code+dept, shift name/time, status badge, leave reason, check-in/out (with late/early/OT/missing-checkout annotations), worked time, and the same `RowActions` (Edit/Absent/Leave) component used on desktop.
- **`/dashboard`** (`page.tsx`): no page-level changes needed — the stat-card grid (`grid-cols-1 sm:grid-cols-3`) and the Today-strip/Biometric-Sync-card rows (`flex flex-wrap`) already stacked correctly below `sm:`; the sidebar fix above was the actual blocker here.
- **`/dashboard/payroll`** (`payroll-client.tsx`): Total Payable box goes `flex-col` below `sm:`; mobile cards show name/code/dept, daily rate, shifts worked, the same `StatusSelect` dropdown, amount, and the missing-checkout note.
- **`/dashboard/reports`** (`reports-client.tsx` + `[workerId]/detail-client.tsx`): monthly summary cards are the whole row wrapped in the worker-detail `<Link>` (same navigation as the desktop name link) showing present/absent/leave/no-record/total-shifts/total-hours/late in a 3-column grid, plus a totals card mirroring the desktop totals row; the per-worker detail page's day-by-day cards show date+shift-sequence badge+status badge, shift name, check-in/out, worked time, and the same notes string (`buildNotes()`) as the desktop Notes column.
- **`/dashboard/roster`** (`roster-client.tsx`): the per-row shift-override `useState`/optimistic-save logic was extracted from `RosterRow` into a shared `useShiftOverride(entry, workDate)` hook so both the desktop `<TableRow>`-based `RosterRow` and the new `<div>`-based `RosterCard` call the identical save/revert/toast logic instead of forking it; each mounted instance keeps its own independent state, which is safe here since the `md` breakpoint (768px) is above any phone's width in either orientation, so the two are never simultaneously visible on one device. Cards show name/code/dept, the Override/Default badge, and a full-width version of the same shift `<Select>`. The override-count amber banner is duplicated (desktop keeps its original placement inside the bordered table box; mobile gets its own bordered box above the cards) rather than shared, to avoid changing the desktop box's exact internal structure. Roster's `page.tsx` summary bar (`active workers · overrides · "no shifts configured"` badge) gained `flex-wrap` — it had no wrapping at all before and could have overflowed with the badge text on a narrow screen.

**Verified:**
- `npx tsc --noEmit` and `npm run build` both clean after every page's edit and once more at the end — 24 routes, same count as before this step (no routes added/removed, this is presentation-only).
- Confirmed by code review (not runtime diffing) that every `hidden md:block` desktop container's inner JSX is character-identical to what existed before this step — the only change at those call sites was adding the `hidden md:block` class itself.
- Started the dev server and curled all 5 pages (`/dashboard`, `/dashboard/attendance`, `/dashboard/payroll`, `/dashboard/reports`, `/dashboard/roster`) unauthenticated — all correctly 307-redirect to `/login` with no 500s, confirming the layout/shell refactor didn't break server-side rendering.
- **What still needs a human's eyes on a real phone** (could not verify visually — no browser/screenshot tool available in this session, and no admin login credentials to drive one anyway): actual rendering/tap-target sizing of the mobile cards on real device widths (375–430px), the hamburger drawer's open/close animation and backdrop behavior, whether the Select dropdowns render acceptably on mobile Safari/Chrome (native `<select>`/Radix popover positioning can behave differently on real touch devices vs. desktop), and whether the reduced `p-4` main padding plus card spacing feels right in practice. Recommend the user open each of the 5 pages on an actual phone in portrait once, and try opening/closing the hamburger menu and toggling a Roster shift override or Payroll status dropdown on a card.

---

## All 23 steps complete. App is in production; the attendance/payroll pipeline correctly handles double shifts end-to-end, a latent stale-data caching bug was found and fixed, the biometric bridge no longer fails wholesale on large first-run backfills, the Attendance page supports instant client-side search/status/department filtering, admins can see biometric bridge health directly on the Dashboard, and the 5 most-used pages (plus the dashboard shell/sidebar) are now usable in portrait on a phone without rotating to landscape.
