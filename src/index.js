#!/usr/bin/env node
"use strict";

/**
 * Nova CLI
 *   nova tools                  list registered capabilities
 *   nova doctor                  check config, binaries, gateway
 *   nova improve "raw ask"       show the rewritten prompt
 *   nova ask [--dry-run] [--improve] [--yes] "do the thing"
 *   nova chat                    interactive REPL
 *   nova serve                   start the HTTP/SSE API for a UI
 */

const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");

const { config, assertReady } = require("./config");
const { loadTools, registry } = require("./tools");
const agent = require("./core/agent");
const { improve } = require("./prompt/improver");

loadTools();

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const BOOLEAN_FLAGS = new Set(["dry-run", "yes", "improve", "trace", "help"]);

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function ttyConfirm(tool, args) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      `  [RISKY:${tool.risk}] ${tool.name}(${JSON.stringify(args)}) — allow? [y/N] `,
      (ans) => {
        rl.close();
        resolve(/^y(es)?$/i.test(ans.trim()));
      }
    );
  });
}

function makeCtx(flags, interactive) {
  return {
    dryRun: !!flags["dry-run"],
    confirmRisky: flags.yes ? false : config.confirmRisky,
    confirm: interactive && !flags.yes ? ttyConfirm : null,
    onEvent: (e) => {
      if (e.type === "tool_call") console.log(`  → ${e.name}(${JSON.stringify(e.args)})`);
      else if (e.type === "tool_result") {
        const tag = e.skipped ? "SKIPPED" : e.ok ? "ok" : "FAILED";
        const first = String(e.output || "").split("\n")[0].slice(0, 160);
        console.log(`    ${tag}: ${first}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

async function cmdTools() {
  const tools = registry.list();
  console.log(`\n${tools.length} tools registered:\n`);
  const byRisk = { high: [], medium: [], low: [] };
  for (const t of tools) byRisk[t.risk].push(t);
  for (const risk of ["high", "medium", "low"]) {
    if (!byRisk[risk].length) continue;
    console.log(`  [${risk.toUpperCase()}]`);
    for (const t of byRisk[risk]) console.log(`    ${t.name.padEnd(18)} ${t.description.split("\n")[0]}`);
    console.log("");
  }
}

async function cmdDoctor() {
  console.log("\nNova doctor\n");
  const ready = assertReady();
  console.log(`  OmniRoute URL      ${config.baseURL}`);
  console.log(`  API key            ${ready.ok ? "present (" + "…".repeat(4) + ")" : "MISSING"}`);
  if (!ready.ok) console.log(`     ${ready.problem}`);
  console.log(`  Model              ${config.model}`);
  console.log(`  Data dir           ${config.paths.data}`);
  console.log(`  Tools              ${registry.list().length}`);

  const bins = [
    ["opencode", config.binaries.opencode],
    ["claude", config.binaries.claude],
    ["code", config.binaries.code],
  ];
  for (const [name, p] of bins) {
    const exists = p && (fs.existsSync(p) || require("node:path").basename(p) === p);
    console.log(`  ${name.padEnd(18)} ${exists ? "ok" : "not found"} (${p})`);
  }

  if (ready.ok) {
    try {
      const res = await fetch(config.baseURL.replace(/\/$/, "") + "/models", {
        headers: { Authorization: "Bearer " + config.apiKey },
      });
      console.log(`  Gateway reachable  ${res.status === 200 ? "yes (HTTP 200)" : "HTTP " + res.status}`);
    } catch (e) {
      console.log(`  Gateway reachable  NO (${e.message})`);
    }
  }
  console.log("");
}

async function cmdImprove(positional) {
  const raw = positional.join(" ").trim();
  if (!raw) return console.log('Usage: nova improve "raw ask"');
  const r = await improve(raw);
  console.log(`\nOriginal:  ${r.original || raw}`);
  console.log(`Improved:  ${r.output}\n`);
}

async function cmdAsk(positional, flags) {
  const raw = positional.join(" ").trim();
  if (!raw) return console.log('Usage: nova ask "do the thing"');

  const ready = assertReady();
  if (!ready.ok && !flags["dry-run"]) {
    console.error("Cannot run: " + ready.problem);
    process.exit(1);
  }

  let message = raw;
  if (flags.improve) {
    console.log(`\n✎ improving prompt…`);
    const r = await improve(raw);
    message = r.output;
    console.log(`✎ ${message}\n`);
  }

  const ctx = makeCtx(flags, true);
  console.log(`\nNova ▸ ${message}\n`);
  const res = await agent.runTurn({ userMessage: message, sessionId: flags.session || "default", ctx });
  console.log(`\n${res.text}\n`);
  if (flags.trace) console.log(`  (${res.steps} steps)`);
}

async function cmdGoal(positional, flags) {
  const objective = positional.join(" ").trim();
  if (!objective) return console.log('Usage: nova goal "big multi-step objective"');
  const ready = assertReady();
  if (!ready.ok && !flags["dry-run"]) {
    console.error("Cannot run: " + ready.problem);
    process.exit(1);
  }
  const ctx = makeCtx(flags, true);
  ctx.onEvent = (e) => {
    if (e.type === "goal_plan") {
      console.log("\nPlanned subtasks:");
      e.subtasks.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
      console.log("");
    } else if (e.type === "goal_step") {
      console.log(`\n[${e.index}/${e.total}] ${e.subtask}`);
    } else if (e.type === "tool_call") {
      console.log(`  → ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.type === "tool_result") {
      const tag = e.skipped ? "SKIPPED" : e.ok ? "ok" : "FAILED";
      console.log(`    ${tag}: ${String(e.output || "").split("\n")[0].slice(0, 140)}`);
    }
  };
  console.log(`\nNova goal ▸ ${objective}\n`);
  const res = await require("./core/goal").runGoal({ objective, sessionId: flags.session, ctx });
  console.log(`\n===== RESULT =====\n${res.text}\n`);
}

async function cmdChat(flags) {
  const ready = assertReady();
  if (!ready.ok) {
    console.error("Cannot run: " + ready.problem);
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ctx = makeCtx(flags, true);
  console.log("\nNova chat — empty line or /quit to exit. /clear resets memory.\n");
  const session = "chat";

  const askOne = () =>
    rl.question("you ▸ ", async (line) => {
      const t = line.trim();
      if (!t || t === "/quit") { rl.close(); return process.exit(0); }
      if (t === "/clear") { require("./core/memory").clear(session); console.log("(memory cleared)"); return askOne(); }
      try {
        const res = await agent.runTurn({ userMessage: t, sessionId: session, ctx });
        console.log(`nova ▸ ${res.text}\n`);
      } catch (e) {
        console.log(`nova ▸ error: ${e.message}\n`);
      }
      askOne();
    });
  askOne();
}

async function cmdServe(flags) {
  const server = require("./api/server");
  server.start({ port: flags.port || config.apiPort, host: flags.host || config.apiHost });
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || "help";
  const rest = argv.slice(1);
  const { flags, positional } = parseArgs(rest);

  switch (cmd) {
    case "tools": return cmdTools();
    case "doctor": return cmdDoctor();
    case "improve": return cmdImprove(positional);
    case "ask": return cmdAsk(positional, flags);
    case "goal": return cmdGoal(positional, flags);
    case "chat": return cmdChat(flags);
    case "serve": return cmdServe(flags);
    default: {
      let title = "Nova — whole-PC assistant engine";
      try {
        title = fs.readFileSync(path.join(__dirname, "..", "ENGINE.md"), "utf8").split("\n")[0].replace(/^#\s*/, "");
      } catch {}
      console.log(`\n${title}`);
      console.log(`
Commands:
  nova doctor
  nova tools
  nova ask [--dry-run] [--improve] [--yes] [--session id] "task"
  nova goal [--yes] "big multi-step objective"
  nova chat
  nova serve [--port 20129]
`);
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e && e.message ? e.message : e);
  process.exit(1);
});
