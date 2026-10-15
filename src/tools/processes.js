"use strict";

const { ps } = require("../util/shell");

/**
 * Process inspection and control.
 */

async function listProcesses({ filter, limit = 25 }) {
  const f = filter ? ` | Where-Object { $_.ProcessName -like '*${String(filter).replace(/'/g, "''")}*' }` : "";
  const script =
    `Get-Process${f} | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First ${Math.max(1, Math.min(100, Number(limit) || 25))} ` +
    "@{n='pid';e={$_.Id}},ProcessName,@{n='memMB';e={[math]::Round($_.WorkingSet64/1MB,1)}},MainWindowTitle " +
    "| ConvertTo-Json -Compress";
  const r = await ps(script, { timeoutMs: 25000 });
  if (r.code !== 0) return { ok: false, output: r.stderr.trim() };
  let j;
  try {
    j = JSON.parse(r.stdout.trim() || "[]");
  } catch {
    return { ok: false, output: r.stdout.trim() || "no output" };
  }
  const rows = Array.isArray(j) ? j : [j];
  return {
    ok: true,
    output:
      rows
        .map((p) => `pid=${p.pid}  ${p.ProcessName}  ${p.memMB}MB  ${p.MainWindowTitle || ""}`.trimEnd())
        .join("\n") || "(none)",
    data: { processes: rows },
  };
}

async function killProcess({ name, pid }) {
  if (!name && !pid) return { ok: false, output: "Provide 'name' or 'pid'." };
  const target = pid ? `-Id ${Number(pid)}` : `-Name '${String(name).replace(/'/g, "''")}'`;
  const r = await ps(`Stop-Process ${target} -ErrorAction Stop`, { timeoutMs: 15000 });
  return {
    ok: r.code === 0,
    output: r.code === 0 ? `Stopped ${pid ? "pid " + pid : name}` : `Failed: ${r.stderr.trim()}`,
  };
}

module.exports = {
  tools: [
    {
      name: "list_processes",
      description: "List running processes (by memory usage). Optionally filter by name substring.",
      risk: "low",
      parameters: {
        type: "object",
        properties: { filter: { type: "string" }, limit: { type: "number" } },
      },
      execute: listProcesses,
    },
    {
      name: "kill_process",
      description: "Force-stop a process by name or PID. HIGH RISK — can close unsaved work.",
      risk: "high",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, pid: { type: "number" } },
      },
      execute: killProcess,
    },
  ],
};
