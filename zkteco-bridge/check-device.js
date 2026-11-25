// Read-only diagnostic: prints the device clock vs this PC's clock, this PC's
// timezone, and the device's enrolled user list. Changes nothing on the
// device or in the app.
// Usage: node check-device.js            (table output)
//        node check-device.js --csv      (CSV user list, easy to paste back)

const ZKLib = require("node-zklib");
const config = require("./config");

// node-zklib 1.3.0 has no getTime() wrapper, so read the clock with the raw
// ZK opcode. The reply is an 8-byte header followed by a uint32 in the same
// packed format the library uses for punch timestamps.
const CMD_GET_TIME = 201;

// Decodes the device's packed time to its wall-clock fields WITHOUT applying
// any timezone — this is exactly what the device's screen shows.
function decodePackedTime(time) {
  const second = time % 60; time = (time - second) / 60;
  const minute = time % 60; time = (time - minute) / 60;
  const hour = time % 24; time = (time - hour) / 24;
  const day = (time % 31) + 1; time = (time - (day - 1)) / 31;
  const month = (time % 12) + 1; time = (time - (month - 1)) / 12;
  const year = time + 2000;
  return { year, month, day, hour, minute, second };
}

const pad = (n) => String(n).padStart(2, "0");
const wall = (t) => `${t.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;

function pcWallClock(d) {
  return wall({
    year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
    hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
  });
}

async function main() {
  const csv = process.argv.includes("--csv");
  const zk = new ZKLib(config.DEVICE_IP, config.DEVICE_PORT, 10000, 4000);
  await zk.createSocket();

  try {
    // ── Clocks ──────────────────────────────────────────────────────────
    const reply = await zk.executeCmd(CMD_GET_TIME, "");
    const pcNow = new Date();
    const dev = decodePackedTime(reply.readUInt32LE(8));
    // The bridge turns device wall-clock times into instants using THIS PC's
    // timezone (node-zklib does `new Date(y, m, d, h, mi, s)`), so the
    // device time interpreted that way is what the app actually stores.
    const devAsStored = new Date(dev.year, dev.month - 1, dev.day, dev.hour, dev.minute, dev.second);
    const driftSec = Math.round((devAsStored - pcNow) / 1000);
    const offsetMin = -pcNow.getTimezoneOffset();
    const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;

    console.log("── Clocks ──");
    console.log(`Device clock (wall time on device): ${wall(dev)}`);
    console.log(`PC clock (local wall time):         ${pcWallClock(pcNow)}`);
    console.log(`PC clock (UTC):                     ${pcNow.toISOString()}`);
    console.log(`PC timezone: ${tzName}, UTC${offsetMin >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`);
    console.log(`Device minus PC: ${driftSec >= 0 ? "+" : ""}${driftSec}s`);
    if (offsetMin !== 300) {
      console.log("WARNING: PC is not on UTC+05:00 — every punch time sent to the app is shifted by the difference.");
    }
    if (Math.abs(driftSec) > 120) {
      console.log("WARNING: device clock differs from PC clock by more than 2 minutes.");
    }
    console.log("Compare the PC clock with a phone/real time too — if the PC itself is wrong, both lines above will agree and still be wrong.\n");

    // ── Users ───────────────────────────────────────────────────────────
    const res = await zk.getUsers();
    const users = (res?.data ?? res ?? [])
      .map((u) => ({ userId: String(u.userId), uid: u.uid, name: (u.name || "").trim(), role: u.role, cardno: u.cardno }))
      .sort((a, b) => Number(a.userId) - Number(b.userId) || a.userId.localeCompare(b.userId));

    console.log(`── Device users (${users.length}) ──`);
    console.log("userId = the deviceUserId the bridge sends to the app (what Workers > Device User ID must match).");
    if (csv) {
      console.log("userId,uid,name,role,cardno");
      for (const u of users) console.log(`${u.userId},${u.uid},"${u.name.replace(/"/g, '""')}",${u.role},${u.cardno}`);
    } else {
      console.table(users);
    }

    const dupes = {};
    for (const u of users) {
      const key = u.name.toLowerCase().replace(/\s+/g, " ");
      if (key) (dupes[key] ??= []).push(u.userId);
    }
    const repeated = Object.entries(dupes).filter(([, ids]) => ids.length > 1);
    if (repeated.length) {
      console.log("\nNames enrolled more than once on the device:");
      for (const [name, ids] of repeated) console.log(`  ${name}: userIds ${ids.join(", ")}`);
    }
  } finally {
    try { await zk.disconnect(); } catch { /* already closed */ }
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exitCode = 1;
});
