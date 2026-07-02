// Quick connectivity check - run this BEFORE index.js when setting up on a
// new terminal PC, to confirm the device is reachable over the LAN.
// Usage: node test-connection.js

const ZKLib = require("node-zklib");
const config = require("./config");

// Raw ZK protocol opcodes for reading device option strings / firmware.
// node-zklib doesn't wrap these as first-class methods, so we call them
// directly via executeCmd() the same way other ZK client libraries do.
const CMD_OPTIONS_RRQ = 11;
const CMD_GET_VERSION = 1100;
const NUL = String.fromCharCode(0);

function cleanReply(buf, prefix) {
  const text = buf.slice(8).toString("ascii"); // strip the ZK reply header
  const withoutPrefix = text.split(prefix).join("");
  // The device pads its fixed-size reply buffer with a NUL terminator,
  // followed by leftover garbage bytes (occasionally a stray "="); truncate
  // at the first NUL and drop any trailing "=" from that garbage.
  const nulIndex = withoutPrefix.indexOf(NUL);
  const truncated = nulIndex === -1 ? withoutPrefix : withoutPrefix.slice(0, nulIndex);
  return truncated.replace(/=+$/, "").trim();
}

async function readOption(zk, keyword) {
  try {
    const data = await zk.executeCmd(CMD_OPTIONS_RRQ, keyword);
    return cleanReply(data, keyword + "=");
  } catch (err) {
    return "(unavailable: " + (err.message || err) + ")";
  }
}

async function readFirmware(zk) {
  try {
    const data = await zk.executeCmd(CMD_GET_VERSION, "");
    return cleanReply(data, "");
  } catch (err) {
    return "(unavailable: " + (err.message || err) + ")";
  }
}

async function main() {
  console.log("Connecting to " + config.DEVICE_IP + ":" + config.DEVICE_PORT + " ...");

  const zk = new ZKLib(config.DEVICE_IP, config.DEVICE_PORT, 10000, 4000);

  try {
    await zk.createSocket();
  } catch (err) {
    console.error("FAILED to connect:", err.message || err);
    console.error(
      "Check that the device and this PC are on the same network, the IP/port in config.js are correct, and the device's TCP/IP settings have communication enabled."
    );
    process.exitCode = 1;
    return;
  }

  console.log("Connected successfully.\n");

  try {
    const info = await zk.getInfo();
    console.log("Enrolled users:   ", info.userCounts);
    console.log("Attendance records stored on device:", info.logCounts);
  } catch (err) {
    console.error("Could not read device counters:", err.message || err);
  }

  // Device name / serial number / firmware are read via a raw protocol
  // opcode this library doesn't officially wrap, so occasionally a stray
  // character shows up at the end (device firmware quirk, not a bug here).
  // Informational only — not used anywhere in the real sync (index.js).
  const deviceName = await readOption(zk, "~DeviceName");
  const serialNumber = await readOption(zk, "~SerialNumber");
  const firmware = await readFirmware(zk);

  console.log("Device name:      ", deviceName);
  console.log("Serial number:    ", serialNumber);
  console.log("Firmware version: ", firmware);

  try {
    await zk.disconnect();
  } catch (err) {
    // not fatal
  }

  console.log("\nConnection test complete.");
}

main().catch((err) => {
  console.error("Unexpected error:", err.message || err);
  process.exitCode = 1;
});
