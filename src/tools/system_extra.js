"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ps } = require("../util/shell");
const { config } = require("../config");

/**
 * Screen, notifications, power and machine info.
 */

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

// --- screenshot -------------------------------------------------------------

async function screenshot({ path: target, monitor }) {
  const dir = path.join(config.paths.data, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const out = target || path.join(dir, `shot-${Date.now()}.png`);
  const scope = String(monitor || "all").toLowerCase();

  // VirtualScreen = all monitors; Screen.PrimaryScreen.Bounds = the main one.
  const bounds =
    scope === "primary" ? "[System.Windows.Forms.Screen]::PrimaryScreen.Bounds" : "[System.Windows.Forms.SystemInformation]::VirtualScreen";
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "Add-Type -AssemblyName System.Drawing; " +
    `$b=${bounds}; ` +
    "if(-not $b){ throw 'could not determine screen bounds' }; " +
    "$bmp=New-Object System.Drawing.Bitmap([int]$b.Width,[int]$b.Height); " +
    "$g=[System.Drawing.Graphics]::FromImage($bmp); " +
    "$g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); " +
    `$bmp.Save(${psQuote(out)},[System.Drawing.Imaging.ImageFormat]::Png); ` +
    "$g.Dispose(); $bmp.Dispose()";

  const r = await ps(script, { timeoutMs: 30000 });
  if (r.code !== 0) return { ok: false, output: `Screenshot failed: ${r.stderr.trim()}` };
  // Verify rather than trust: confirm the file really exists.
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
    return { ok: false, output: `Screenshot reported success but no file was written (${out}).` };
  }
  return { ok: true, output: `Screenshot saved to ${out}`, data: { path: out, bytes: fs.statSync(out).size } };
}

// --- toast notification -----------------------------------------------------

async function notify({ title = "Nova", message = "" }) {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "Add-Type -AssemblyName System.Drawing; " +
    "$n=New-Object System.Windows.Forms.NotifyIcon; " +
    "$n.Icon=[System.Drawing.SystemIcons]::Information; " +
    "$n.BalloonTipTitle=" +
    psQuote(title) +
    "; $n.BalloonTipText=" +
    psQuote(message) +
    "; $n.Visible=$true; $n.ShowBalloonTip(5000); Start-Sleep -Milliseconds 6000; $n.Dispose()";
  const r = await ps(script, { timeoutMs: 20000 });
  return { ok: r.code === 0, output: r.code === 0 ? "Notification shown." : r.stderr.trim() };
}

// --- machine info -----------------------------------------------------------

async function systemInfo() {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; " +
    "$p=[System.Windows.Forms.SystemInformation]::PowerStatus; " +
    "[pscustomobject]@{ " +
    "now=(Get-Date).ToString('yyyy-MM-dd HH:mm:ss dddd'); " +
    "os=[System.Environment]::OSVersion.VersionString; " +
    "user=[System.Environment]::UserName; " +
    "machine=[System.Environment]::MachineName; " +
    "batteryPercent=[math]::Round($p.BatteryLifePercent*100); " +
    "acPower=$p.PowerLineStatus.ToString(); " +
    "cpus=[System.Environment]::ProcessorCount " +
    "} | ConvertTo-Json -Compress";
  const r = await ps(script, { timeoutMs: 20000 });
  if (r.code !== 0) return { ok: false, output: r.stderr.trim() };
  let j = {};
  try {
    j = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  } catch {
    return { ok: false, output: "Could not read system info." };
  }
  return {
    ok: true,
    output: `${j.now}\nuser ${j.user}@${j.machine}\nbattery ${j.batteryPercent}% (${j.acPower})\ncpus ${j.cpus}`,
    data: j,
  };
}

async function getTime() {
  const now = new Date();
  return {
    ok: true,
    output: now.toString(),
    data: { iso: now.toISOString(), local: now.toLocaleString() },
  };
}

// --- power ------------------------------------------------------------------

async function lockPc() {
  const r = await ps("rundll32.exe user32.dll,LockWorkStation", { timeoutMs: 10000 });
  return { ok: r.code === 0, output: r.code === 0 ? "Workstation locked." : r.stderr.trim() };
}

async function sleepPc() {
  const r = await ps("rundll32.exe powrprof.dll,SetSuspendState 0,1,0", { timeoutMs: 10000 });
  return { ok: r.code === 0, output: r.code === 0 ? "Suspending…" : r.stderr.trim() };
}

async function wait({ seconds = 1 }) {
  const s = Math.max(0, Math.min(120, Number(seconds) || 0));
  await new Promise((res) => setTimeout(res, s * 1000));
  return { ok: true, output: `Waited ${s}s` };
}

module.exports = {
  tools: [
    {
      name: "screenshot",
      description: "Capture the screen (all monitors, or 'primary') to a PNG file. Returns the file path.",
      risk: "low",
      parameters: {
        type: "object",
        properties: {
          monitor: { type: "string", description: "'all' (default) or 'primary'" },
          path: { type: "string", description: "Optional output file path." },
        },
      },
      execute: screenshot,
    },
    {
      name: "notify",
      description: "Show a Windows notification (toast) with a title and message.",
      risk: "low",
      parameters: {
        type: "object",
        properties: { title: { type: "string" }, message: { type: "string" } },
        required: ["message"],
      },
      execute: notify,
    },
    {
      name: "system_info",
      description: "Get the current date/time, OS, user, machine name and battery status.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: systemInfo,
    },
    {
      name: "get_time",
      description: "Get the current local date and time.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: getTime,
    },
    {
      name: "wait",
      description: "Pause for N seconds before the next step (useful to let an app load).",
      risk: "low",
      parameters: { type: "object", properties: { seconds: { type: "number" } }, required: ["seconds"] },
      execute: wait,
    },
    {
      name: "lock_pc",
      description: "Lock the Windows workstation.",
      risk: "medium",
      parameters: { type: "object", properties: {} },
      execute: lockPc,
    },
    {
      name: "sleep_pc",
      description: "Put the computer to sleep.",
      risk: "high",
      parameters: { type: "object", properties: {} },
      execute: sleepPc,
    },
  ],
};
