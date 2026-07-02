// One-shot sync: connect to the device, pull attendance logs, forward any
// logs newer than the last successful sync to the attendance app, then exit.
// Windows Task Scheduler re-runs this on a fixed interval — there is no
// polling loop here on purpose.

const fs = require("fs");
const path = require("path");
const ZKLib = require("node-zklib");
const config = require("./config");

const LAST_SYNC_FILE = path.join(__dirname, "last-sync.json");
const CONNECT_TIMEOUT_MS = 10000;
const UDP_FALLBACK_PORT = 4000;

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function loadLastSyncedAt() {
  try {
    const raw = fs.readFileSync(LAST_SYNC_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const d = new Date(parsed.lastSyncedAt);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null; // first run, or file missing/corrupt — treat as "sync everything"
  }
}

function saveLastSyncedAt(date) {
  fs.writeFileSync(
    LAST_SYNC_FILE,
    JSON.stringify({ lastSyncedAt: date.toISOString() }, null, 2)
  );
}

async function main() {
  const lastSyncedAt = loadLastSyncedAt();
  log(
    lastSyncedAt
      ? `Last successful sync: ${lastSyncedAt.toISOString()}`
      : "No last-sync.json found — this looks like the first run, syncing all logs on the device"
  );

  const zk = new ZKLib(
    config.DEVICE_IP,
    config.DEVICE_PORT,
    CONNECT_TIMEOUT_MS,
    UDP_FALLBACK_PORT
  );

  try {
    await zk.createSocket();
  } catch (err) {
    log(
      `ERROR: could not connect to the device at ${config.DEVICE_IP}:${config.DEVICE_PORT} —`,
      err.message || err
    );
    process.exitCode = 1;
    return;
  }

  log("Connected to device. Downloading attendance logs...");

  let logs;
  try {
    logs = await zk.getAttendances();
  } catch (err) {
    log("ERROR: failed to read attendance logs from the device —", err.message || err);
    process.exitCode = 1;
    await safeDisconnect(zk);
    return;
  }

  await safeDisconnect(zk);

  const allRecords = logs?.data ?? [];
  log(`Device returned ${allRecords.length} total log record(s).`);

  const newRecords = lastSyncedAt
    ? allRecords.filter((r) => r.recordTime && new Date(r.recordTime) > lastSyncedAt)
    : allRecords;

  if (newRecords.length === 0) {
    log("No new punches since last sync. Nothing to send.");
    return;
  }

  // Sort chronologically — the app decides check-in vs check-out based on
  // what's already stored, so punches must arrive in time order within a batch.
  newRecords.sort((a, b) => new Date(a.recordTime) - new Date(b.recordTime));

  const punches = newRecords.map((r) => ({
    deviceUserId: String(r.deviceUserId),
    timestamp: new Date(r.recordTime).toISOString(),
  }));

  log(`Sending ${punches.length} new punch(es) to the app...`);

  let response;
  try {
    response = await fetch(config.APP_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-secret": config.BRIDGE_SECRET,
      },
      body: JSON.stringify(punches),
    });
  } catch (err) {
    log("ERROR: could not reach the app endpoint —", err.message || err);
    process.exitCode = 1;
    return;
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON body, fall through to the !response.ok branch below
  }

  if (!response.ok) {
    log(`ERROR: app responded with HTTP ${response.status}:`, body ?? "(no JSON body)");
    process.exitCode = 1;
    return;
  }

  log("Sync summary:", {
    processed: body.processed,
    checkedIn: body.checkedIn,
    checkedOut: body.checkedOut,
    duplicates: body.duplicates,
    alreadyComplete: body.alreadyComplete,
    unmatched: body.unmatched,
  });

  // Advance the checkpoint to the newest punch we just sent successfully.
  const latest = newRecords.reduce(
    (max, r) => (new Date(r.recordTime) > max ? new Date(r.recordTime) : max),
    lastSyncedAt || new Date(0)
  );
  saveLastSyncedAt(latest);
  log(`last-sync.json updated -> ${latest.toISOString()}`);
}

async function safeDisconnect(zk) {
  try {
    await zk.disconnect();
  } catch {
    // already disconnected or device dropped the connection — not fatal
  }
}

main()
  .catch((err) => {
    log("ERROR: unexpected failure —", err.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    log("Bridge run finished.");
  });
