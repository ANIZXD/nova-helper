"use strict";

const path = require("node:path");
const { ps, run, POWERSHELL } = require("../util/shell");

/**
 * System volume via the Core Audio API (src/scripts/audio.ps1).
 *
 * This gives accurate get/set/mute on the default output device. If Core Audio
 * is unavailable for any reason, we fall back to the low-level keyboard volume
 * keys (approximate for `set`, exact for up/down/mute).
 */

const AUDIO_PS1 = path.join(__dirname, "..", "scripts", "audio.ps1");

async function coreAudio(action, value, timeoutMs = 20000) {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", AUDIO_PS1, action];
  if (value != null) args.push(String(value));
  const r = await run(POWERSHELL, args, { timeoutMs });
  if (!r || r.code !== 0) return null;
  try {
    const j = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
    return j && j.ok ? j : null;
  } catch {
    return null;
  }
}

// --- fallback: virtual volume keys (P/Invoke keybd_event) -------------------

const VK_VOLUME_UP = 0xaf;
const VK_VOLUME_DOWN = 0xae;
const VK_VOLUME_MUTE = 0xad;

function keyEvents(pairs) {
  const sig =
    '[DllImport("user32.dll", SetLastError=true)] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';
  const calls = pairs
    .map(
      ([vk, times]) =>
        `$i=0; while($i -lt ${times}){ $k::keybd_event(${vk},0,0,[UIntPtr]::Zero); $k::keybd_event(${vk},0,2,[UIntPtr]::Zero); $i++ }`
    )
    .join("; ");
  return `$sig='${sig}'; $k=Add-Type -MemberDefinition $sig -Name Kb -Namespace Nova -PassThru; ${calls}`;
}

// --- tools -----------------------------------------------------------------

async function volumeGet() {
  const j = await coreAudio("get");
  if (j) {
    return { ok: true, output: `Volume is ${j.volume}%${j.muted ? " (muted)" : ""}`, data: { volume: j.volume, muted: j.muted } };
  }
  return { ok: false, output: "Could not read the system volume." };
}

async function volumeSet({ percent }) {
  const p = Math.max(0, Math.min(100, Number(percent)));
  if (Number.isNaN(p)) return { ok: false, output: "'percent' must be a number 0-100" };
  const j = await coreAudio("set", p);
  if (j) return { ok: true, output: `Volume set to ${j.volume}%`, data: { volume: j.volume, muted: j.muted } };

  // fallback: reset to 0 then step up (~2% per tap on Windows).
  const r = await ps(keyEvents([[VK_VOLUME_DOWN, 50], [VK_VOLUME_UP, Math.round(p / 2)]]), { timeoutMs: 25000 });
  return { ok: r.code === 0, output: r.code === 0 ? `Volume set to ~${p}%` : r.stderr.trim() };
}

async function volumeUp({ percent = 10 }) {
  const cur = await coreAudio("get");
  if (cur) return volumeSet({ percent: Math.min(100, cur.volume + Math.max(1, Number(percent) || 10)) });
  const r = await ps(keyEvents([[VK_VOLUME_UP, 5]]), { timeoutMs: 15000 });
  return { ok: r.code === 0, output: r.code === 0 ? "Volume up" : r.stderr.trim() };
}

async function volumeDown({ percent = 10 }) {
  const cur = await coreAudio("get");
  if (cur) return volumeSet({ percent: Math.max(0, cur.volume - Math.max(1, Number(percent) || 10)) });
  const r = await ps(keyEvents([[VK_VOLUME_DOWN, 5]]), { timeoutMs: 15000 });
  return { ok: r.code === 0, output: r.code === 0 ? "Volume down" : r.stderr.trim() };
}

async function volumeMute({ muted }) {
  let action = "toggle";
  if (muted === true) action = "mute";
  else if (muted === false) action = "unmute";
  const j = await coreAudio(action);
  if (j) return { ok: true, output: j.muted ? "Muted." : "Unmuted.", data: { muted: j.muted, volume: j.volume } };
  const r = await ps(keyEvents([[VK_VOLUME_MUTE, 1]]), { timeoutMs: 15000 });
  return { ok: r.code === 0, output: r.code === 0 ? "Mute toggled" : r.stderr.trim() };
}

module.exports = {
  tools: [
    {
      name: "volume_get",
      description: "Read the current system volume (percent) and mute state.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: volumeGet,
    },
    {
      name: "volume_set",
      description: "Set the system volume to an exact percentage (0-100).",
      risk: "low",
      parameters: { type: "object", properties: { percent: { type: "number", description: "0-100" } }, required: ["percent"] },
      execute: volumeSet,
    },
    {
      name: "volume_up",
      description: "Turn the system volume up (by percent, default 10).",
      risk: "low",
      parameters: { type: "object", properties: { percent: { type: "number" } } },
      execute: volumeUp,
    },
    {
      name: "volume_down",
      description: "Turn the system volume down (by percent, default 10).",
      risk: "low",
      parameters: { type: "object", properties: { percent: { type: "number" } } },
      execute: volumeDown,
    },
    {
      name: "volume_mute",
      description: "Mute, unmute, or toggle the system mute. Omit 'muted' to toggle.",
      risk: "low",
      parameters: { type: "object", properties: { muted: { type: "boolean", description: "true=mute, false=unmute, omit=toggle" } } },
      execute: volumeMute,
    },
  ],
};
