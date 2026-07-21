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

// Runs the actual sync and returns a plain result object describing what
// happened — never throws for expected failure modes (device unreachable,
// app endpoint down, etc.); those are reported in the result instead so the
// caller can always send a heartbeat, success or failure.
async function run() {
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
    const message = `Could not connect to the device at ${config.DEVICE_IP}:${config.DEVICE_PORT} — ${err.message || err}`;
    log(`ERROR: ${message}`);
    process.exitCode = 1;
    return { success: false, recordsSynced: 0, message };
  }

  log("Connected to device. Downloading attendance logs...");

  let logs;
  try {
    logs = await zk.getAttendances();
  } catch (err) {
    const message = `Failed to read attendance logs from the device — ${err.message || err}`;
    log(`ERROR: ${message}`);
    process.exitCode = 1;
    await safeDisconnect(zk);
    return { success: false, recordsSynced: 0, message };
  }

  await safeDisconnect(zk);

  const allRecords = logs?.data ?? [];
  log(`Device returned ${allRecords.length} total log record(s).`);

  const newRecords = lastSyncedAt
    ? allRecords.filter((r) => r.recordTime && new Date(r.recordTime) > lastSyncedAt)
    : allRecords;

  if (newRecords.length === 0) {
    log("No new punches since last sync. Nothing to send.");
    return { success: true, recordsSynced: 0, message: "No new punches since last sync." };
  }

  // Sort chronologically — the app decides check-in vs check-out based on
  // what's already stored, so punches must arrive in time order within a batch.
  newRecords.sort((a, b) => new Date(a.recordTime) - new Date(b.recordTime));

  const punches = newRecords.map((r) => ({
    deviceUserId: String(r.deviceUserId),
    timestamp: new Date(r.recordTime).toISOString(),
  }));

  // Large first-run backfills can contain hundreds of records — sending them
  // all in one POST can take longer than the app's serverless function
  // allows and the whole request times out with nothing saved. Sending in
  // small sequential chunks keeps each request fast and lets us keep
  // whatever succeeded even if a later chunk fails.
  const CHUNK_SIZE = 50;
  const chunks = [];
  for (let i = 0; i < newRecords.length; i += CHUNK_SIZE) {
    chunks.push(newRecords.slice(i, i + CHUNK_SIZE));
  }

  log(
    `Sending ${punches.length} new punch(es) to the app in ${chunks.length} chunk(s) of up to ${CHUNK_SIZE}...`
  );

  const combined = {
    processed: 0,
    checkedIn: 0,
    checkedOut: 0,
    duplicates: 0,
    alreadyComplete: 0,
    unmatched: [],
  };

  let latest = lastSyncedAt || new Date(0);
  let anyChunkSucceeded = false;
  let anyChunkFailed = false;
  // Once a chunk fails, stop advancing the checkpoint even if later chunks
  // succeed — otherwise the failed chunk's records would fall before the
  // saved checkpoint and never be retried.
  let stopAdvancingCheckpoint = false;

  for (let i = 0; i < chunks.length; i++) {
    const chunkRecords = chunks[i];
    const chunkPunches = chunkRecords.map((r) => ({
      deviceUserId: String(r.deviceUserId),
      timestamp: new Date(r.recordTime).toISOString(),
    }));

    let response;
    try {
      response = await fetch(config.APP_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bridge-secret": config.BRIDGE_SECRET,
        },
        body: JSON.stringify(chunkPunches),
      });
    } catch (err) {
      log(
        `ERROR: chunk ${i + 1}/${chunks.length} failed — could not reach the app endpoint —`,
        err.message || err
      );
      anyChunkFailed = true;
      stopAdvancingCheckpoint = true;
      continue;
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      // non-JSON body, fall through to the !response.ok branch below
    }

    if (!response.ok) {
      log(
        `ERROR: chunk ${i + 1}/${chunks.length} failed — app responded with HTTP ${response.status}:`,
        body ?? "(no JSON body)"
      );
      anyChunkFailed = true;
      stopAdvancingCheckpoint = true;
      continue;
    }

    anyChunkSucceeded = true;
    combined.processed += body?.processed || 0;
    combined.checkedIn += body?.checkedIn || 0;
    combined.checkedOut += body?.checkedOut || 0;
    combined.duplicates += body?.duplicates || 0;
    combined.alreadyComplete += body?.alreadyComplete || 0;
    if (Array.isArray(body?.unmatched)) combined.unmatched.push(...body.unmatched);

    log(`Chunk ${i + 1}/${chunks.length} sent OK (${chunkPunches.length} punch(es)).`);

    if (!stopAdvancingCheckpoint) {
      latest = chunkRecords.reduce(
        (max, r) => (new Date(r.recordTime) > max ? new Date(r.recordTime) : max),
        latest
      );
    }
  }

  if (!anyChunkSucceeded) {
    const message = "All chunks failed to send. No punches were confirmed; last-sync.json left unchanged.";
    log(`ERROR: ${message}`);
    process.exitCode = 1;
    return { success: false, recordsSynced: 0, message };
  }

  log("Sync summary:", combined);

  if (anyChunkFailed) {
    process.exitCode = 1;
    saveLastSyncedAt(latest);
    const message =
      `Partial failure: ${combined.processed} of ${newRecords.length} punch(es) sent. ` +
      `Checkpoint advanced only through the last contiguous successful chunk -> ${latest.toISOString()}. ` +
      `Records at/after the failed chunk will be retried on the next scheduled run.`;
    log(`WARNING: ${message}`);
    log(`last-sync.json updated -> ${latest.toISOString()}`);
    return { success: false, recordsSynced: combined.processed, message };
  }

  // Advance the checkpoint to the newest punch we confirmed successfully.
  saveLastSyncedAt(latest);
  log(`last-sync.json updated -> ${latest.toISOString()}`);
  return {
    success: true,
    recordsSynced: combined.processed,
    message: `Synced ${combined.processed} punch(es) (${combined.checkedIn} check-in, ${combined.checkedOut} check-out, ${combined.duplicates} duplicate).`,
  };
}

async function safeDisconnect(zk) {
  try {
    await zk.disconnect();
  } catch {
    // already disconnected or device dropped the connection — not fatal
  }
}

// Reports the outcome of a run to the app so an admin can see bridge health
// without checking this machine directly. Deliberately never lets a
// heartbeat failure (network blip, app briefly down) affect the process
// exit code or bubble up — the sync itself already succeeded or failed on
// its own merits by the time this runs.
async function sendHeartbeat(result) {
  try {
    const response = await fetch(config.HEARTBEAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bridge-secret": config.BRIDGE_SECRET,
      },
      body: JSON.stringify({
        ranAt: new Date().toISOString(),
        success: result.success,
        recordsSynced: result.recordsSynced,
        message: result.message,
      }),
    });
    if (!response.ok) {
      log(`WARNING: heartbeat POST returned HTTP ${response.status}`);
    } else {
      log("Heartbeat sent.");
    }
  } catch (err) {
    log("WARNING: failed to send heartbeat —", err.message || err);
  }
}

async function main() {
  let result;
  try {
    result = await run();
  } catch (err) {
    const message = `Unexpected failure — ${err.message || err}`;
    log(`ERROR: ${message}`);
    process.exitCode = 1;
    result = { success: false, recordsSynced: 0, message };
  }
  await sendHeartbeat(result);
}

main()
  .catch((err) => {
    log("ERROR: unexpected failure —", err.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    log("Bridge run finished.");
  });
