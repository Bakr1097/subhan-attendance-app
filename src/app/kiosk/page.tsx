import { db } from "@/lib/db";
import { terminals, workers, departments, attendanceRecords } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import Link from "next/link";
import { KioskClient, type WorkerEntry } from "./kiosk-client";

export default async function KioskPage({
  searchParams,
}: {
  searchParams: { terminal?: string };
}) {
  const allTerminals = await db
    .select({ id: terminals.id, name: terminals.name })
    .from(terminals)
    .orderBy(terminals.name);

  if (!searchParams.terminal) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-8 text-white px-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Attendance Kiosk</h1>
          <p className="text-slate-400 mt-2 text-lg">Select your terminal to begin</p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          {allTerminals.map((t) => (
            <Link
              key={t.id}
              href={`/kiosk?terminal=${t.id}`}
              className="bg-slate-700 hover:bg-slate-600 active:bg-slate-500 transition-colors text-center py-5 px-6 rounded-2xl text-xl font-semibold"
            >
              {t.name}
            </Link>
          ))}
          {allTerminals.length === 0 && (
            <p className="text-slate-500 text-center">No terminals configured yet.</p>
          )}
        </div>
      </div>
    );
  }

  const terminalId = searchParams.terminal;
  const terminal = allTerminals.find((t) => t.id === terminalId);

  if (!terminal) {
    return (
      <div className="flex items-center justify-center h-full text-white">
        <div className="text-center space-y-3">
          <p className="text-xl">Terminal not found.</p>
          <Link href="/kiosk" className="text-slate-400 underline text-sm">
            Back to terminal selection
          </Link>
        </div>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  const workerRows = await db
    .select({
      id: workers.id,
      employeeCode: workers.employeeCode,
      fullName: workers.fullName,
      referencePhotoUrl: workers.referencePhotoUrl,
      deptName: departments.name,
    })
    .from(workers)
    .leftJoin(departments, eq(workers.departmentId, departments.id))
    .where(and(eq(workers.terminalId, terminalId), eq(workers.status, "active")))
    .orderBy(workers.fullName);

  const todayRecords =
    workerRows.length > 0
      ? await db
          .select({
            workerId: attendanceRecords.workerId,
            checkInAt: attendanceRecords.checkInAt,
            checkOutAt: attendanceRecords.checkOutAt,
          })
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.terminalId, terminalId),
              eq(attendanceRecords.workDate, today)
            )
          )
      : [];

  const recordMap = new Map(todayRecords.map((r) => [r.workerId, r]));

  const workerList: WorkerEntry[] = workerRows.map((w) => {
    const rec = recordMap.get(w.id);
    return {
      id: w.id,
      employeeCode: w.employeeCode,
      fullName: w.fullName,
      referencePhotoUrl: w.referencePhotoUrl ?? null,
      deptName: w.deptName ?? "—",
      checkedIn: !!rec?.checkInAt,
      checkedOut: !!rec?.checkOutAt,
    };
  });

  return (
    <KioskClient
      terminalId={terminalId}
      terminalName={terminal.name}
      workers={workerList}
    />
  );
}
