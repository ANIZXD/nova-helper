"use strict";

/**
 * Window control via PowerShell. Uses Get-Process MainWindowHandle rather than
 * EnumWindows (simpler and reliable on Windows 10/11).
 */

const { ps } = require("../util/shell");

const SW_MINIMIZE = 6;
const SW_MAXIMIZE = 3;
const SW_RESTORE = 9;

async function getWindows() {
  const r = await ps(
    "Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim() } | " +
      "Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress",
    { timeoutMs: 20000 }
  );
  if (r.code !== 0) return [];
  try {
    const j = JSON.parse(r.stdout);
    return Array.isArray(j) ? j : [j];
  } catch {
    return [];
  }
}

function pickWindow(windows, { pid, title_contains, process_name }) {
  if (pid) return windows.find((w) => String(w.Id) === String(pid)) || null;
  let cands = windows;
  if (process_name) {
    const pn = String(process_name).toLowerCase().replace(/\.exe$/, "");
    cands = cands.filter((w) => String(w.ProcessName).toLowerCase() === pn);
  }
  if (title_contains) {
    const t = String(title_contains).toLowerCase();
    cands = cands.filter((w) => String(w.MainWindowTitle).toLowerCase().includes(t));
  }
  return cands[0] || null;
}

async function listWindows() {
  const ws = await getWindows();
  return {
    ok: true,
    output: ws.map((w) => `pid=${w.Id} [${w.ProcessName}] ${w.MainWindowTitle}`).join("\n") || "(no windows)",
    data: { windows: ws },
  };
}

async function focusWindow(args = {}) {
  const ws = await getWindows();
  const w = pickWindow(ws, args);
  if (!w) return { ok: false, output: "No matching window found. Try list_windows first." };
  const r = await ps(
    `$p=Get-Process -Id ${Number(w.Id)}; ` +
      `$s='[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);'; ` +
      `$t=Add-Type -MemberDefinition $s -Name U32 -Namespace Nova -PassThru; ` +
      `[void]$t::SetForegroundWindow($p.MainWindowHandle)`,
    { timeoutMs: 15000 }
  );
  return {
    ok: r.code === 0,
    output: r.code === 0 ? `Focused: ${w.MainWindowTitle}` : "SetForegroundWindow failed",
    data: { pid: w.Id, title: w.MainWindowTitle },
  };
}

async function windowState({ state, pid, title_contains, process_name }) {
  const ws = await getWindows();
  const w = pickWindow(ws, { pid, title_contains, process_name });
  if (!w) return { ok: false, output: "No matching window found." };

  const map = { minimize: SW_MINIMIZE, maximize: SW_MAXIMIZE, restore: SW_RESTORE };
  const cmd = String(state || "restore").toLowerCase();
  if (cmd === "close") {
    const r = await ps(`Stop-Process -Id ${Number(w.Id)} -ErrorAction SilentlyContinue`, { timeoutMs: 15000 });
    return { ok: r.code === 0, output: `Closed: ${w.MainWindowTitle}` };
  }
  const sw = map[cmd];
  if (!sw) return { ok: false, output: `Unknown state '${state}'. Use minimize|maximize|restore|close.` };

  const r = await ps(
    `$p=Get-Process -Id ${Number(w.Id)}; ` +
      `$s='[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);'; ` +
      `$t=Add-Type -MemberDefinition $s -Name U32b -Namespace Nova -PassThru; ` +
      `[void]$t::ShowWindow($p.MainWindowHandle, ${sw})`,
    { timeoutMs: 15000 }
  );
  return { ok: r.code === 0, output: `${cmd}: ${w.MainWindowTitle}` };
}

module.exports = {
  focusWindow,
  listWindows,
  windowState,
  tools: [
    {
      name: "list_windows",
      description: "List currently visible windows with their PID and title (useful before focus/control).",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: listWindows,
    },
    {
      name: "focus_window",
      description: "Bring a window to the foreground by title substring, process name, or PID.",
      risk: "low",
      parameters: {
        type: "object",
        properties: {
          title_contains: { type: "string" },
          process_name: { type: "string" },
          pid: { type: "number" },
        },
      },
      execute: focusWindow,
    },
    {
      name: "window_state",
      description: "Minimize, maximize, restore, or close a window (by title substring, process name, or PID).",
      risk: "high",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "minimize | maximize | restore | close" },
          title_contains: { type: "string" },
          process_name: { type: "string" },
          pid: { type: "number" },
        },
        required: ["state"],
      },
      execute: windowState,
    },
  ],
};
