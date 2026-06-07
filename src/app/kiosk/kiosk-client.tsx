"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  cacheWorkers,
  getCachedWorkers,
  enqueuePunch,
  getPendingPunches,
  removePunch,
  getPunchQueueCount,
} from "@/lib/kiosk-idb";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WorkerEntry {
  id: string;
  employeeCode: string;
  fullName: string;
  referencePhotoUrl: string | null;
  deptName: string;
  checkedIn: boolean;
  checkedOut: boolean;
}

type KioskStage =
  | { tag: "grid" }
  | { tag: "pin"; worker: WorkerEntry }
  | { tag: "camera"; worker: WorkerEntry; pin: string }
  | { tag: "processing" }
  | { tag: "success"; workerName: string; action: "check-in" | "check-out"; timeStr: string; queued?: boolean }
  | { tag: "error"; message: string; worker: WorkerEntry; pin: string };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(d: Date): string {
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Live clock ────────────────────────────────────────────────────────────────

function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <div className="text-right">
      <div className="text-3xl font-mono font-bold tabular-nums text-white">
        {hh}:{mm}:{ss}
      </div>
      <div className="text-slate-400 text-sm">{dateStr}</div>
    </div>
  );
}

// ─── Worker avatar ─────────────────────────────────────────────────────────────

function WorkerAvatar({
  name,
  photoUrl,
  size = "md",
}: {
  name: string;
  photoUrl: string | null;
  size?: "md" | "lg";
}) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const [imgError, setImgError] = useState(false);

  const sizeClass = size === "lg" ? "text-4xl" : "text-2xl";

  if (photoUrl && !imgError) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="w-full h-full object-cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center bg-slate-700">
      <span className={`text-slate-200 font-bold ${sizeClass}`}>{initials}</span>
    </div>
  );
}

// ─── PIN pad ───────────────────────────────────────────────────────────────────

function PinPad({
  onComplete,
  onCancel,
}: {
  onComplete: (pin: string) => void;
  onCancel: () => void;
}) {
  const [digits, setDigits] = useState<string[]>([]);

  function pressDigit(d: string) {
    if (digits.length >= 4) return;
    const next = [...digits, d];
    setDigits(next);
    if (next.length === 4) {
      setTimeout(() => onComplete(next.join("")), 80);
    }
  }

  function pressDelete() {
    setDigits((prev) => prev.slice(0, -1));
  }

  const btnBase =
    "w-20 h-20 rounded-full text-white font-semibold text-2xl transition-all active:scale-95 flex items-center justify-center";

  return (
    <div className="flex flex-col items-center gap-8">
      {/* PIN dots */}
      <div className="flex gap-5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-5 h-5 rounded-full border-2 transition-all duration-150 ${
              i < digits.length
                ? "bg-white border-white scale-110"
                : "border-slate-500"
            }`}
          />
        ))}
      </div>

      {/* Number grid */}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            onClick={() => pressDigit(d)}
            className={`${btnBase} bg-slate-700 hover:bg-slate-600`}
          >
            {d}
          </button>
        ))}

        {/* Bottom row: cancel | 0 | delete */}
        <button
          onClick={onCancel}
          className={`${btnBase} bg-transparent text-slate-400 text-base hover:text-white hover:bg-slate-800`}
        >
          Cancel
        </button>
        <button
          onClick={() => pressDigit("0")}
          className={`${btnBase} bg-slate-700 hover:bg-slate-600`}
        >
          0
        </button>
        <button
          onClick={pressDelete}
          className={`${btnBase} bg-transparent text-slate-300 text-xl hover:bg-slate-800`}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}

// ─── Camera capture ────────────────────────────────────────────────────────────

function CameraCapture({
  onCapture,
}: {
  onCapture: (photoBase64: string | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedRef = useRef(false);
  const [countdown, setCountdown] = useState(3);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(false);

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: 480, height: 360 } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => setCameraReady(true);
        }
      })
      .catch(() => {
        // Guard matches capturedRef used in the countdown path — prevents
        // React 18 Strict Mode's double-effect invocation from firing onCapture twice.
        if (!capturedRef.current) {
          capturedRef.current = true;
          setCameraError(true);
          onCapture(null);
        }
      });

    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!cameraReady || cameraError) return;
    if (countdown <= 0) {
      if (!capturedRef.current) {
        capturedRef.current = true;
        doCapture();
      }
      return;
    }
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown, cameraReady, cameraError]);

  function doCapture() {
    const video = videoRef.current;
    if (!video) {
      onCapture(null);
      return;
    }
    const W = 480;
    const H = 360;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(-1, 1);
      ctx.drawImage(video, -W, 0, W, H);
    }
    const base64 = canvas.toDataURL("image/jpeg", 0.72);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(base64);
  }

  if (cameraError) {
    return (
      <p className="text-slate-400 text-center text-sm">
        No camera detected — proceeding without photo…
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-64 h-48 rounded-2xl overflow-hidden bg-slate-800 ring-2 ring-slate-600">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover scale-x-[-1]"
        />
        {!cameraReady && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
        {cameraReady && countdown > 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/25">
            <span className="text-white text-7xl font-bold tabular-nums drop-shadow-xl">
              {countdown}
            </span>
          </div>
        )}
        {countdown === 0 && (
          <div className="absolute inset-0 bg-white/60 transition-opacity" />
        )}
      </div>
      <p className="text-slate-400 text-sm">
        {!cameraReady
          ? "Starting camera…"
          : countdown > 0
          ? `Photo in ${countdown}…`
          : "Captured!"}
      </p>
    </div>
  );
}

// ─── Worker card ───────────────────────────────────────────────────────────────

function WorkerCard({
  worker,
  onClick,
}: {
  worker: WorkerEntry;
  onClick: () => void;
}) {
  const statusLabel = worker.checkedOut
    ? "Done"
    : worker.checkedIn
    ? "In"
    : null;

  const statusColor = worker.checkedOut
    ? "bg-blue-500"
    : worker.checkedIn
    ? "bg-green-500"
    : null;

  return (
    <button
      onClick={onClick}
      className="flex flex-col rounded-2xl overflow-hidden bg-slate-800 hover:bg-slate-700 active:scale-95 transition-all duration-150 border border-slate-700 hover:border-slate-500"
    >
      {/* Photo */}
      <div className="relative w-full aspect-square">
        <WorkerAvatar name={worker.fullName} photoUrl={worker.referencePhotoUrl} />
        {statusLabel && statusColor && (
          <div
            className={`absolute top-2 right-2 ${statusColor} text-white text-xs font-bold px-2 py-0.5 rounded-full`}
          >
            {statusLabel}
          </div>
        )}
      </div>

      {/* Name */}
      <div className="px-2 py-2 text-center">
        <p className="text-white text-sm font-medium leading-tight line-clamp-2">
          {worker.fullName}
        </p>
        <p className="text-slate-500 text-xs mt-0.5">{worker.employeeCode}</p>
      </div>
    </button>
  );
}

// ─── Main kiosk client ─────────────────────────────────────────────────────────

export function KioskClient({
  terminalId,
  terminalName,
  workers: initialWorkers,
}: {
  terminalId: string;
  terminalName: string;
  workers: WorkerEntry[];
}) {
  const [workers, setWorkers] = useState(initialWorkers);
  const [stage, setStage] = useState<KioskStage>({ tag: "grid" });
  const [search, setSearch] = useState("");
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const syncingRef = useRef(false);
  const processingRef = useRef(false);

  // ── Queue helpers ─────────────────────────────────────────────────────────────

  const refreshQueueCount = useCallback(async () => {
    try {
      const count = await getPunchQueueCount();
      setQueueCount(count);
    } catch {}
  }, []);

  const syncQueue = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const pending = await getPendingPunches();
      const today = todayStr();
      for (const punch of pending) {
        try {
          const res = await fetch("/api/kiosk/attend", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workerId: punch.workerId,
              pin: punch.pin,
              photoBase64: punch.photoBase64,
              workDate: punch.workDate,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            await removePunch(punch.id!);
            // Only update the displayed grid if the punch is for today
            if (punch.workDate === today) {
              setWorkers((prev) =>
                prev.map((w) =>
                  w.id === punch.workerId
                    ? { ...w, checkedIn: true, checkedOut: data.action === "check-out" }
                    : w
                )
              );
            }
          } else if (res.status >= 400 && res.status < 500) {
            // Permanent failure (wrong PIN, already complete, etc.) — discard
            await removePunch(punch.id!);
          }
          // 5xx: leave in queue, retry next cycle
        } catch {
          // Network error mid-sync — stop and retry on next online event
          break;
        }
      }
    } finally {
      syncingRef.current = false;
      await refreshQueueCount();
    }
  }, [refreshQueueCount]);

  // ── Mount: cache SSR workers, set online state, initial sync ──────────────────

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const today = todayStr();
    if (initialWorkers.length > 0) {
      cacheWorkers(terminalId, today, initialWorkers).catch(() => {});
    }

    refreshQueueCount();

    if (navigator.onLine) {
      syncQueue();
    }

    const handleOnline = () => {
      setIsOnline(true);
      syncQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ── Worker refresh every 5 minutes while online ───────────────────────────────

  useEffect(() => {
    if (!isOnline) return;

    async function refreshWorkers() {
      const today = todayStr();
      try {
        const res = await fetch(`/api/kiosk/workers?terminal=${terminalId}&date=${today}`);
        if (res.ok) {
          const data = await res.json();
          const fresh = data.workers as WorkerEntry[];
          setWorkers(fresh);
          await cacheWorkers(terminalId, today, fresh);
        }
      } catch {}
    }

    const id = setInterval(refreshWorkers, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [isOnline, terminalId]);

  // ── Auto-reset after success ──────────────────────────────────────────────────

  useEffect(() => {
    if (stage.tag === "success") {
      const id = setTimeout(() => {
        setStage({ tag: "grid" });
        setSearch("");
      }, 3000);
      return () => clearTimeout(id);
    }
  }, [stage]);

  // ── Stage transitions ─────────────────────────────────────────────────────────

  function selectWorker(worker: WorkerEntry) {
    setStage({ tag: "pin", worker });
  }

  function cancelPin() {
    setStage({ tag: "grid" });
  }

  function onPinComplete(pin: string) {
    if (stage.tag !== "pin") return;
    processingRef.current = false;
    setStage({ tag: "camera", worker: stage.worker, pin });
  }

  async function onPhotoCapture(photoBase64: string | null) {
    if (stage.tag !== "camera") return;
    // Synchronous ref lock — immune to React's batched state updates.
    // Prevents a second invocation from slipping through while the first
    // is still awaiting enqueuePunch or the attend API call.
    if (processingRef.current) return;
    processingRef.current = true;
    const { worker, pin } = stage;
    setStage({ tag: "processing" });

    const workDate = todayStr();
    const action: "check-in" | "check-out" = worker.checkedIn ? "check-out" : "check-in";

    // ── Offline: queue immediately without attempting the network ─────────────
    if (!navigator.onLine) {
      try {
        await enqueuePunch({ workerId: worker.id, pin, photoBase64, workDate, queuedAt: Date.now(), terminalId });
        await refreshQueueCount();
      } catch {}
      setWorkers((prev) =>
        prev.map((w) =>
          w.id === worker.id
            ? { ...w, checkedIn: true, checkedOut: action === "check-out" }
            : w
        )
      );
      setStage({ tag: "success", workerName: worker.fullName, action, timeStr: formatTime(new Date()), queued: true });
      return;
    }

    // ── Online: try the network, fall back to queue on failure ────────────────
    try {
      const res = await fetch("/api/kiosk/attend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: worker.id, pin, photoBase64, workDate }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStage({ tag: "error", message: data.error ?? "Something went wrong. Please try again.", worker, pin });
        return;
      }

      setWorkers((prev) =>
        prev.map((w) =>
          w.id === worker.id
            ? { ...w, checkedIn: true, checkedOut: data.action === "check-out" }
            : w
        )
      );

      setStage({
        tag: "success",
        workerName: data.workerName,
        action: data.action,
        timeStr: data.timestamp,
      });
    } catch {
      // Network error while nominally online — queue for later sync
      try {
        await enqueuePunch({ workerId: worker.id, pin, photoBase64, workDate, queuedAt: Date.now(), terminalId });
        await refreshQueueCount();
      } catch {}
      setWorkers((prev) =>
        prev.map((w) =>
          w.id === worker.id
            ? { ...w, checkedIn: true, checkedOut: action === "check-out" }
            : w
        )
      );
      setStage({ tag: "success", workerName: worker.fullName, action, timeStr: formatTime(new Date()), queued: true });
    }
  }

  const filteredWorkers = workers.filter(
    (w) =>
      w.fullName.toLowerCase().includes(search.toLowerCase()) ||
      w.employeeCode.toLowerCase().includes(search.toLowerCase())
  );

  // ── Queued / success screen ───────────────────────────────────────────────────
  if (stage.tag === "success") {
    const isCheckIn = stage.action === "check-in";
    const isQueued = stage.queued;

    const circleColor = isQueued
      ? "bg-amber-600"
      : isCheckIn
      ? "bg-green-500"
      : "bg-blue-500";

    const labelColor = isQueued
      ? "text-amber-400"
      : isCheckIn
      ? "text-green-400"
      : "text-blue-400";

    const label = isQueued
      ? isCheckIn ? "Check-In Queued" : "Check-Out Queued"
      : isCheckIn ? "Checked In" : "Checked Out";

    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-white">
        <div className={`w-28 h-28 rounded-full flex items-center justify-center ${circleColor}`}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-14 h-14"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <div className="text-center space-y-1">
          <p className={`text-3xl font-bold ${labelColor}`}>{label}</p>
          <p className="text-2xl font-semibold">{stage.workerName}</p>
          {isQueued ? (
            <p className="text-amber-500/80 text-sm">Will sync when back online</p>
          ) : (
            <p className="text-slate-400 text-lg">{stage.timeStr}</p>
          )}
        </div>
        <p className="text-slate-600 text-sm animate-pulse">Resetting in a moment…</p>
      </div>
    );
  }

  // ── Error screen ──────────────────────────────────────────────────────────────
  if (stage.tag === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-white">
        <div className="w-24 h-24 rounded-full bg-red-600 flex items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-12 h-12"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </div>
        <div className="text-center space-y-2">
          <p className="text-2xl font-bold text-red-400">Error</p>
          <p className="text-slate-300 max-w-xs text-center">{stage.message}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() =>
              setStage({ tag: "camera", worker: stage.worker, pin: stage.pin })
            }
            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-semibold transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={() => setStage({ tag: "grid" })}
            className="px-6 py-3 bg-transparent text-slate-400 hover:text-white rounded-xl font-semibold transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ── Processing spinner ────────────────────────────────────────────────────────
  if (stage.tag === "processing") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-white">
        <div className="w-16 h-16 border-4 border-slate-600 border-t-white rounded-full animate-spin" />
        <p className="text-slate-400">Recording attendance…</p>
      </div>
    );
  }

  // ── PIN overlay ───────────────────────────────────────────────────────────────
  const isPinOrCamera = stage.tag === "pin" || stage.tag === "camera";
  const overlayWorker = stage.tag === "pin" ? stage.worker : stage.tag === "camera" ? stage.worker : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">{terminalName}</h1>
            <p className="text-slate-500 text-sm">Attendance Kiosk</p>
          </div>
          {/* Offline indicator */}
          <div className="flex items-center gap-1.5 ml-1">
            <div
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isOnline ? "bg-green-500" : "bg-amber-500 animate-pulse"
              }`}
            />
            {!isOnline && (
              <span className="text-amber-400 text-xs font-medium">
                {queueCount > 0 ? `Offline · ${queueCount} queued` : "Offline"}
              </span>
            )}
          </div>
        </div>
        <Clock />
      </header>

      {/* Worker grid */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search by name or employee code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-xl px-4 py-3 text-sm outline-none focus:border-slate-500 transition-colors"
          />
        </div>

        {filteredWorkers.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-slate-500">
            {search ? `No workers matching "${search}"` : "No active workers."}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredWorkers.map((w) => (
              <WorkerCard key={w.id} worker={w} onClick={() => selectWorker(w)} />
            ))}
          </div>
        )}
      </div>

      {/* PIN / Camera overlay */}
      {isPinOrCamera && overlayWorker && (
        <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center gap-8 z-10">
          {/* Worker info */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-slate-600">
              <WorkerAvatar
                name={overlayWorker.fullName}
                photoUrl={overlayWorker.referencePhotoUrl}
                size="lg"
              />
            </div>
            <div className="text-center">
              <p className="text-white text-xl font-bold">{overlayWorker.fullName}</p>
              <p className="text-slate-500 text-sm">{overlayWorker.employeeCode}</p>
            </div>
          </div>

          {stage.tag === "pin" && (
            <>
              <p className="text-slate-400 text-sm -mt-2">Enter your 4-digit PIN</p>
              <PinPad
                onComplete={onPinComplete}
                onCancel={cancelPin}
              />
            </>
          )}

          {stage.tag === "camera" && (
            <>
              <p className="text-slate-400 text-sm -mt-2">Look at the camera</p>
              <CameraCapture onCapture={onPhotoCapture} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
