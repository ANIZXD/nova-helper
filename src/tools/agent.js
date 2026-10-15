"use strict";

const fs = require("node:fs");
const { run, ps, spawnDetached } = require("../util/shell");
const { config } = require("../config");

function pick(bin) {
  return bin && fs.existsSync(bin) ? bin : null;
}

/** Run a headless coding agent and return its output. */
async function spawnAgent(kind, { prompt, cwd, timeoutSeconds, extraArgs = [] }) {
  if (!prompt) return { ok: false, output: "'prompt' is required" };
  const dir = cwd && fs.existsSync(cwd) ? cwd : process.cwd();

  if (kind === "opencode") {
    const exe = pick(config.binaries.opencode) || "opencode";
    const args = ["run", "--auto", ...extraArgs, prompt];
    const r = await run(exe, args, {
      cwd: dir,
      timeoutMs: Math.max(5000, Math.min(900000, (Number(timeoutSeconds) || 300) * 1000)),
    });
    const out = (r.stdout || "").split(/\r?\n/).filter((l) => !/^>\s/.test(l)).join("\n").trim();
    return {
      ok: r.code === 0,
      output: out || r.stderr.trim() || "(no output)",
      data: { exitCode: r.code, agent: "opencode", cwd: dir },
    };
  }

  // claude
  const exe = pick(config.binaries.claude) || "claude";
  const args = ["-p", "--dangerously-skip-permissions", prompt];
  const r = await run(exe, args, {
    cwd: dir,
    timeoutMs: Math.max(5000, Math.min(900000, (Number(timeoutSeconds) || 300) * 1000)),
  });
  const out = (r.stdout || "").split(/\r?\n/).filter((l) => !/classifier requests/i.test(l)).join("\n").trim();
  return {
    ok: r.code === 0,
    output: out || r.stderr.trim() || "(no output)",
    data: { exitCode: r.code, agent: "claude", cwd: dir },
  };
}

/** Open a visible console window that runs a command interactively. */
async function runInTerminal({ command, title }) {
  if (!command) return { ok: false, output: "'command' is required" };
  const t = (title || "Nova Terminal").replace(/'/g, "''");
  const c = command.replace(/'/g, "''");
  const r = await ps(
    `Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', ${"'"}${c}${"'"} -WorkingDirectory ${"'"}${process.cwd()}${"'"} `,
    { timeoutMs: 15000 }
  );
  // The above Start-Process launches a visible console running the command.
  return { ok: r.code === 0, output: r.code === 0 ? `Opened terminal running: ${command}` : r.stderr.trim() };
}

/** Open a project in VS Code and kick a headless agent in it. */
async function devTask({ prompt, projectPath, agent = "opencode" }) {
  const dir = projectPath && fs.existsSync(projectPath) ? projectPath : process.cwd();
  // 1. open VS Code at the project
  const codeBin = config.binaries.code || "code";
  await run(codeBin, ["-n", dir], { timeoutMs: 20000 });
  // 2. run the agent headless there
  const res = await spawnAgent(agent, { prompt, cwd: dir });
  return {
    ok: res.ok,
    output: `Opened VS Code at ${dir}\n--- agent output ---\n${res.output}`,
    data: { project: dir, agent },
  };
}

module.exports = {
  spawnAgent,
  tools: [
    {
      name: "spawn_opencode",
      description:
        "Run the OpenCode coding agent headless on a task and return what it did. Use for real dev work " +
        "(build features, write code, fix bugs) on the user's behalf.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The task, as a clear instruction." },
          cwd: { type: "string", description: "Project directory." },
          session: { type: "string", description: "Continue an existing OpenCode session id." },
          timeoutSeconds: { type: "number", description: "Default 300." },
        },
        required: ["prompt"],
      },
      execute: async (a) =>
        spawnAgent("opencode", { ...a, extraArgs: a.session ? ["--session", String(a.session)] : [] }),
    },
    {
      name: "spawn_claude",
      description: "Run the Claude Code agent headless on a task and return its output.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          cwd: { type: "string" },
          timeoutSeconds: { type: "number" },
        },
        required: ["prompt"],
      },
      execute: (a) => spawnAgent("claude", a),
    },
    {
      name: "run_in_terminal",
      description:
        "Open a NEW visible console window that runs a command interactively (stays open). " +
        "Use when the user wants to SEE the work happen, e.g. launch an interactive coding agent.",
      risk: "high",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "e.g. `opencode` or `npm run dev`" },
          title: { type: "string" },
        },
        required: ["command"],
      },
      execute: runInTerminal,
    },
    {
      name: "dev_task",
      description:
        "Open a project in VS Code AND run a headless coding agent on a task in it. " +
        "Best for: 'open VS Code and tell it to make an app'.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          projectPath: { type: "string", description: "Project directory." },
          agent: { type: "string", description: "opencode (default) | claude" },
        },
        required: ["prompt"],
      },
      execute: devTask,
    },
  ],
};
