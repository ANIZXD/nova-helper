"use strict";

const { ps } = require("../util/shell");

/**
 * Media transport control via the virtual media keys.
 * Works with whatever the OS currently has as the active media session
 * (Spotify, YouTube in a browser, Groove, VLC…).
 */

const VK = {
  next: 0xb0,
  prev: 0xb1,
  stop: 0xb2,
  play_pause: 0xb3,
};

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

async function tap(vk, label) {
  const r = await ps(keyEvents([[vk, 1]]), { timeoutMs: 15000 });
  return { ok: r.code === 0, output: r.code === 0 ? label : r.stderr.trim() };
}

module.exports = {
  tools: [
    {
      name: "media_play_pause",
      description: "Toggle play/pause for the active media (music/video) session.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: () => tap(VK.play_pause, "Toggled play/pause"),
    },
    {
      name: "media_next",
      description: "Skip to the next track / media item.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: () => tap(VK.next, "Skipped to next"),
    },
    {
      name: "media_prev",
      description: "Go back to the previous track / media item.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: () => tap(VK.prev, "Went to previous"),
    },
    {
      name: "media_stop",
      description: "Stop the active media session.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: () => tap(VK.stop, "Stopped media"),
    },
  ],
};
