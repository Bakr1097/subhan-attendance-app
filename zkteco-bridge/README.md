# ZKTeco MB460 Bridge

This is a small standalone program that runs on the PC next to the biometric
attendance terminal. Every few minutes it:

1. Connects to the ZKTeco MB460 device over the local network
2. Downloads the punches (fingerprint taps) stored on the device
3. Sends any punches it hasn't sent before to the attendance app online
4. Disconnects and exits

It does **not** run all the time in the background — it runs once, does its
job, and exits. Windows Task Scheduler is what makes it run automatically
every 5 minutes (set up in Step 4 below).

This folder is self-contained and does not affect the main attendance app.

---

## Configuration

All the settings this bridge needs are in `config.js`:

- Device IP: `192.168.1.201`
- Device Port: `4370`
- App endpoint: `https://subhan-attendance-app.vercel.app/api/biometric/punch`
- Heartbeat endpoint: `https://subhan-attendance-app.vercel.app/api/biometric/heartbeat`
  (reports whether each run succeeded — see "Health monitoring" below)
- Bridge secret: (already filled in — must match the `BRIDGE_API_SECRET`
  value set in the app's Vercel environment variables)

If the device's IP address ever changes, or the app moves to a different
domain, update `config.js` — it's the only file that needs to change.

---

## Setup on the terminal PC

### 1. Install Node.js

Download and install the **LTS** version from:
https://nodejs.org/

During installation, just click "Next" through the defaults — no special
options are needed.

### 2. Copy this folder to the terminal PC

Copy the entire `zkteco-bridge` folder onto the terminal PC (USB drive, or
download it directly if the PC has internet access). A good location is:

```
C:\zkteco-bridge
```

### 3. Install dependencies

Open **Command Prompt** (search "cmd" in the Start menu), then run:

```
cd C:\zkteco-bridge
npm install
```

Wait for it to finish — it downloads one small package the bridge needs to
talk to the device.

### 4. Test the device connection

Before running the real sync, confirm the PC can actually reach the device:

```
node test-connection.js
```

If it's working, you'll see the device name, serial number, firmware
version, and the number of attendance records currently stored on the
device. If it fails, double check:

- The device and this PC are on the **same local network** (same WiFi/LAN)
- The IP address in `config.js` still matches the device's IP
- The device's network/communication settings have TCP communication enabled

### 5. Test a real sync

```
node index.js
```

This connects to the device, downloads any punches, and sends them to the
live app. You'll see a summary in the console like:

```
Sync summary: { processed: 3, checkedIn: 2, checkedOut: 1, duplicates: 0, alreadyComplete: 0, unmatched: [] }
```

If a worker's fingerprint punch shows up under `unmatched`, it means no
worker in the app has that Device User ID saved yet — go to **Workers** in
the app, edit that worker, and fill in their **Biometric Device User ID**
(the ID they're enrolled under on the terminal).

### 6. Set up Windows Task Scheduler (runs it automatically every 5 minutes)

This makes Windows run `node index.js` every 5 minutes on its own, so you
never have to run it by hand.

1. Press the **Start** button, type **Task Scheduler**, and open it.
2. In the right-hand panel, click **Create Task...** (not "Create Basic Task").
3. On the **General** tab:
   - Name: `ZKTeco Attendance Sync`
   - Select **Run whether user is logged on or not**
   - Check **Run with highest privileges**
4. Go to the **Triggers** tab, click **New...**:
   - Begin the task: **On a schedule**
   - Select **Daily**, set start time to any time (e.g. now)
   - Check **Repeat task every:** and choose **5 minutes**
   - Set **for a duration of:** to **Indefinitely**
   - Click **OK**
5. Go to the **Actions** tab, click **New...**:
   - Action: **Start a program**
   - Program/script: `node`
   - Add arguments: `index.js`
   - Start in: `C:\zkteco-bridge` (or wherever you copied the folder)
   - Click **OK**
6. Go to the **Conditions** tab:
   - Uncheck **Start the task only if the computer is on AC power** (so it
     still runs on a laptop running on battery, if applicable)
7. Click **OK** to save the task. Windows may ask for the PC's login
   password — enter it.
8. To confirm it works, right-click the task in the list and choose **Run**.
   Then check `last-sync.json` in the `zkteco-bridge` folder — its
   timestamp should update.

That's it. From now on, punches from the terminal will show up in the
attendance app automatically within a few minutes of being recorded on the
device.

---

## Health monitoring

After every run (whether it succeeds or fails), the bridge sends a short
status report to the app — this powers the **"Biometric Sync"** card on the
app's Dashboard page (admin login required), so you can check from your
phone or any browser whether the bridge is actually running on schedule
without needing to walk over to the terminal PC.

If the app hasn't received a successful report in the last 15 minutes, the
Dashboard shows a red "Bridge may be down" warning. If you see that warning,
check on the terminal PC: is it powered on, connected to the network, and is
the scheduled task still enabled in Task Scheduler?

Sending this report never blocks or fails the actual sync — if the app is
briefly unreachable when the report is sent, the bridge just logs it and
moves on; the next run will report again as usual.

---

## Notes

- **Device and PC must be on the same local network.** This bridge talks to
  the device directly over the LAN — it will not work if the device and this
  PC are on different networks (e.g. one on WiFi guest network, one on the
  main network).
- **`last-sync.json`** is created automatically the first time `index.js`
  runs successfully. It just remembers the timestamp of the last punch that
  was sent, so the next run only sends new punches. Don't edit it by hand;
  if it's ever deleted, the next run will simply re-send everything currently
  on the device (harmless — the app safely ignores punches it's already
  recorded).
- **The device's clock must be set correctly** (correct date, time, and
  timezone for this location) — punch times are read as-is from the device
  and sent to the app.
- If the device is unreachable when `index.js` runs (network down, device
  off), it logs the error and exits — nothing crashes, and the next
  scheduled run will simply try again.
