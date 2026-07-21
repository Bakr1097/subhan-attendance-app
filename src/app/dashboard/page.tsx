import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  terminals,
  departments,
  workers,
  supervisorScopes,
  shifts,
  attendanceRecords,
} from "@/db/schema";
import { eq, and, count, inArray } from "drizzle-orm";
import { Building2, Layers, Users, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { flagMissingCheckout, type ShiftData } from "@/lib/attendance";
import { getPayrollCutoffTime, getBiometricSyncStatus } from "@/lib/settings";
import { computePayrollForWorkers, STATUS_MULTIPLIER } from "@/lib/payroll-report";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

function formatRelativeTime(iso: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin === 1) return "1 minute ago";
  if (diffMin < 60) return `${diffMin} minutes ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr === 1) return "1 hour ago";
  if (diffHr < 24) return `${diffHr} hours ago`;
  const diffDay = Math.round(diffHr / 24);
  return diffDay === 1 ? "1 day ago" : `${diffDay} days ago`;
}

const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
];

function formatToday(): string {
  const d = new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtPKR(n: number): string {
  return `Rs ${n.toLocaleString("en-PK")}`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const [terminalCount] = await db.select({ value: count() }).from(terminals);
  const [deptCount] = await db.select({ value: count() }).from(departments);
  const [workerCount] = await db
    .select({ value: count() })
    .from(workers)
    .where(eq(workers.status, "active"));

  const stats = [
    {
      label: "Terminals",
      value: terminalCount.value,
      icon: Building2,
      href: "/dashboard/terminals",
    },
    {
      label: "Departments",
      value: deptCount.value,
      icon: Layers,
      href: "/dashboard/departments",
    },
    {
      label: "Active Workers",
      value: workerCount.value,
      icon: Users,
      href: "/dashboard/workers",
    },
  ];

  // ── Today strip: scoped to what this user can see ────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const isAdmin = session.user.role === "admin";

  let allowedDeptIds: string[];

  if (isAdmin) {
    allowedDeptIds = (
      await db.select({ id: departments.id }).from(departments)
    ).map((d) => d.id);
  } else {
    const scopes = await db
      .select()
      .from(supervisorScopes)
      .where(eq(supervisorScopes.userId, session.user.id));

    const allDepts = await db.select().from(departments);
    const ids: string[] = [];
    for (const scope of scopes) {
      if (scope.departmentId) {
        ids.push(scope.departmentId);
      } else {
        allDepts
          .filter((d) => d.terminalId === scope.terminalId)
          .forEach((d) => ids.push(d.id));
      }
    }
    allowedDeptIds = Array.from(new Set(ids));
  }

  const scopedWorkers =
    allowedDeptIds.length > 0
      ? await db
          .select({
            id: workers.id,
            payType: workers.payType,
            dailyRate: workers.dailyRate,
          })
          .from(workers)
          .where(
            and(
              eq(workers.status, "active"),
              inArray(workers.departmentId, allowedDeptIds)
            )
          )
      : [];

  const workerIds = scopedWorkers.map((w) => w.id);

  // A worker may have multiple records today (Step 19 double shifts). Each
  // record already stores the shift that was resolved at check-in time, so
  // there's no need to separately re-resolve today's shift_assignments here.
  const records =
    workerIds.length > 0
      ? await db
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.workDate, today),
              inArray(attendanceRecords.workerId, workerIds)
            )
          )
      : [];
  const recordsByWorker = new Map<string, typeof records>();
  for (const r of records) {
    if (!recordsByWorker.has(r.workerId)) recordsByWorker.set(r.workerId, []);
    recordsByWorker.get(r.workerId)!.push(r);
  }

  const shiftIds = new Set<string>();
  records.forEach((r) => { if (r.resolvedShiftId) shiftIds.add(r.resolvedShiftId); });

  const shiftRows =
    shiftIds.size > 0
      ? await db
          .select()
          .from(shifts)
          .where(inArray(shifts.id, Array.from(shiftIds)))
      : [];
  const shiftMap = new Map(shiftRows.map((s) => [s.id, s]));

  // Payable figure uses the Step 18 closing-window model (not calendar day) so
  // it matches what the Payroll page would show for a closing run today.
  let payrollComputedMap = new Map<string, { status: "full" | "half" | "double" | "absent" }>();
  if (isAdmin) {
    const dailyWorkerIds = scopedWorkers
      .filter((w) => w.payType === "daily")
      .map((w) => w.id);
    if (dailyWorkerIds.length > 0) {
      const cutoffTime = await getPayrollCutoffTime();
      payrollComputedMap = await computePayrollForWorkers(dailyWorkerIds, today, cutoffTime);
    }
  }

  const biometricStatus = isAdmin ? await getBiometricSyncStatus() : null;
  const minutesSinceSuccess = biometricStatus?.lastSuccessAt
    ? Date.now() - new Date(biometricStatus.lastSuccessAt).getTime()
    : null;
  const bridgeMayBeDown =
    biometricStatus !== null &&
    (biometricStatus.lastSuccessAt === null || minutesSinceSuccess! > FIFTEEN_MINUTES_MS);

  const now = new Date();
  let presentToday = 0;
  let absentToday = 0;
  let lateToday = 0;
  let missingCheckoutToday = 0;
  let payableToday = 0;

  function toShiftData(shiftId: string | null): ShiftData | null {
    const row = shiftId ? shiftMap.get(shiftId) : null;
    return row
      ? {
          startTime: row.startTime,
          endTime: row.endTime,
          graceMinutes: row.graceMinutes,
          earlyLeaveGraceMinutes: row.earlyLeaveGraceMinutes,
          crossesMidnight: row.crossesMidnight,
        }
      : null;
  }

  for (const w of scopedWorkers) {
    // Present/absent are per-WORKER (a double shift is still one present
    // person); late/missing-checkout stay per-SHIFT (row-level).
    const recs = recordsByWorker.get(w.id) ?? [];
    if (recs.some((r) => r.status === "present")) presentToday++;
    if (recs.some((r) => r.status === "absent")) absentToday++;

    for (const record of recs) {
      if (record.isLate) lateToday++;

      const shiftData = toShiftData(record.resolvedShiftId);
      const checkoutMissing =
        record.checkInAt && !record.checkOutAt && shiftData
          ? flagMissingCheckout(record.checkInAt, null, shiftData, today, now)
          : record.checkoutMissing;
      if (checkoutMissing) missingCheckoutToday++;
    }

    if (isAdmin && w.payType === "daily") {
      const computed = payrollComputedMap.get(w.id);
      const rate = w.dailyRate ?? 0;
      if (computed) {
        payableToday += Math.round(rate * STATUS_MULTIPLIER[computed.status]);
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Welcome back, {session.user.name}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Today strip */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">
          Today — {formatToday()}
        </h2>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border rounded-lg bg-white px-4 py-3 text-sm">
          <span>
            <span className="font-semibold text-green-600">{presentToday}</span>{" "}
            <span className="text-muted-foreground">present</span>
          </span>
          <span>
            <span className="font-semibold text-red-600">{absentToday}</span>{" "}
            <span className="text-muted-foreground">absent</span>
          </span>
          <span className="text-amber-700">
            <span className="font-semibold">{lateToday}</span> late
          </span>
          <span className="flex items-center gap-1 text-orange-600">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="font-semibold">{missingCheckoutToday}</span> missing checkout
          </span>
          {isAdmin && (
            <span className="sm:ml-auto">
              <span className="text-muted-foreground mr-1.5">Today&apos;s Payable:</span>
              <span className="font-bold text-primary text-base">{fmtPKR(payableToday)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Biometric bridge health — admin-only */}
      {isAdmin && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            Biometric Sync
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              {!biometricStatus ? (
                <p className="text-sm text-muted-foreground">
                  No sync data yet — the bridge hasn&apos;t reported in.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                    <span>
                      <span className="text-muted-foreground">Last run:</span>{" "}
                      <span className="font-medium">
                        {formatRelativeTime(biometricStatus.ranAt)}
                      </span>
                    </span>
                    <Badge
                      variant="secondary"
                      className={
                        biometricStatus.success
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }
                    >
                      {biometricStatus.success ? "Success" : "Failed"}
                    </Badge>
                    <span>
                      <span className="font-semibold">
                        {biometricStatus.recordsSynced}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        record{biometricStatus.recordsSynced === 1 ? "" : "s"} synced last run
                      </span>
                    </span>
                  </div>
                  {biometricStatus.message && (
                    <p className="text-xs text-muted-foreground">
                      {biometricStatus.message}
                    </p>
                  )}
                  {bridgeMayBeDown && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      ⚠ Bridge may be down — last successful sync was{" "}
                      {biometricStatus.lastSuccessAt
                        ? formatRelativeTime(biometricStatus.lastSuccessAt)
                        : "never recorded"}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
