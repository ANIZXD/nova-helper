"use strict";

const path = require("node:path");
const { ps, run, spawnDetached, POWERSHELL } = require("../util/shell");
const { config } = require("../config");

/** Map a friendly app name to an executable we can launch directly. */
const KNOWN_APPS = {
  notepad: "notepad.exe",
  calc: "calc.exe",
  calculator: "calc.exe",
  explorer: "explorer.exe",
  taskmanager: "taskmgr.exe",
  paint: "mspaint.exe",
  cmd: "cmd.exe",
  powershell: "powershell.exe",
  edge: "msedge.exe",
  chrome: "chrome.exe",
  firefox: "firefox.exe",
};

async function openApp({ name, path: targetPath }) {
  if (!name || typeof name !== "string") return { ok: false, output: "'name' is required" };
  const n = name.trim();

  // VS Code gets special handling so we can open a folder in it.
  if (/^(code|vscode)$/i.test(n)) {
    const dir = targetPath && require("node:fs").existsSync(targetPath) ? targetPath : process.cwd();
    const r = await run(config.binaries.code, ["-n", dir], { timeoutMs: 20000 });
    return {
      ok: r.code === 0,
      output: r.code === 0 ? `Opened VS Code at ${dir}` : `code failed: ${r.stderr.trim()}`,
      data: { dir },
    };
  }

  const exe = KNOWN_APPS[n.toLowerCase()];
  if (exe) {
    const res = spawnDetached(exe, [], {});
    return { ok: res.ok, output: res.ok ? `Launched ${n} (${exe})` : `Launch failed: ${res.error}` };
  }

  // Unknown name: let Windows resolve it (works for UWP apps and PATH entries).
  const r = await ps(`Start-Process -FilePath '${n.replace(/'/g, "''")}'`, { timeoutMs: 20000 });
  if (r.code === 0) return { ok: true, output: `Launched ${n}` };
  return {
    ok: false,
    output: `Could not launch '${n}'. Known apps: ${Object.keys(KNOWN_APPS).join(", ")}, or pass an .exe name.`,
  };
}

function normalizeUrl(u) {
  if (!u) return null;
  u = String(u).trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/\.[a-z]{2,}(\/|$)/i.test(u) || /^localhost/i.test(u)) return "https://" + u;
  return null; // let the caller fall back to search
}

async function openUrl({ url }) {
  const u = normalizeUrl(url);
  if (!u) return { ok: false, output: `Not a URL: ${url}` };
  const r = await ps(`Start-Process '${u.replace(/'/g, "''")}'`, { timeoutMs: 20000 });
  return { ok: r.code === 0, output: r.code === 0 ? `Opened ${u}` : `Failed to open ${u}` };
}

async function openFolder({ path: dir }) {
  const d = dir && require("node:fs").existsSync(dir) ? dir : process.cwd();
  const res = spawnDetached("explorer.exe", [d], {});
  return { ok: res.ok, output: res.ok ? `Opened ${d}` : res.error };
}

async function searchWeb({ query, engine }) {
  if (!query) return { ok: false, output: "'query' is required" };
  const q = encodeURIComponent(query);
  const base =
    (engine || "").toLowerCase() === "youtube"
      ? "https://www.youtube.com/results?search_query="
      : (engine || "").toLowerCase() === "github"
        ? "https://github.com/search?q="
        : "https://www.google.com/search?q=";
  return openUrl({ url: base + q });
}

/** Runs an arbitrary shell command. HIGH RISK — gated behind confirmation. */
async function runCommand({ command, cwd, timeoutSeconds }) {
  if (!command) return { ok: false, output: "'command' is required" };
  const r = await ps(command, {
    cwd: cwd && require("node:fs").existsSync(cwd) ? cwd : process.cwd(),
    timeoutMs: Math.max(1000, Math.min(600000, (Number(timeoutSeconds) || 30) * 1000)),
  });
  const out = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n");
  return {
    ok: r.code === 0,
    output: out || "(no output)",
    data: { exitCode: r.code },
  };
}

module.exports = [
  {
    name: "open_app",
    description: "Launch a desktop application by name (notepad, calc, chrome, code/vscode, or any .exe).",
    risk: "medium",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "App name or executable." },
        path: { type: "string", description: "Optional folder to open with VS Code." },
      },
      required: ["name"],
    },
    execute: openApp,
  },
  {
    name: "open_url",
    description: "Open a URL in the default browser.",
    risk: "low",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    execute: openUrl,
  },
  {
    name: "open_folder",
    description: "Open a folder in File Explorer.",
    risk: "low",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute folder path." } },
    },
    execute: openFolder,
  },
  {
    name: "search_web",
    description: "Search the web (Google by default, or youtube/github) and open the results.",
    risk: "low",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        engine: { type: "string", description: "google | youtube | github (default google)" },
      },
      required: ["query"],
    },
    execute: searchWeb,
  },
  {
    name: "run_command",
    description:
      "Run an arbitrary PowerShell command and return its output. HIGH RISK: this can modify or delete anything. " +
      "Use only when the user explicitly asks, or when no safer tool applies.",
    risk: "high",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "PowerShell command to run." },
        cwd: { type: "string", description: "Optional working directory." },
        timeoutSeconds: { type: "number", description: "Timeout (default 30)." },
      },
      required: ["command"],
    },
    execute: runCommand,
  },
];
