"use strict";

/**
 * Nova HTTP API + SSE event stream. This is the seam any UI (Electron, web,
 * Claude, whatever) talks to. No external dependencies.
 *
 *   GET  /health           -> { ok, version, model, tools }
 *   GET  /tools            -> tool list (name, description, risk, parameters)
 *   POST /improve          { prompt }                  -> { improved }
 *   POST /ask              { message, sessionId, improve?, dryRun? } -> { text, steps, trace }
 *   POST /confirm          { id, approve }             -> resolves a pending risky action
 *   POST /clear            { sessionId }               -> reset memory
 *   GET  /events           -> SSE stream of live events (tool_call, tool_result,
 *                             confirm_request, final, ...)
 *
 * Risky tools pause and emit `confirm_request`; the UI must POST /confirm.
 */

const http = require("node:http");
const { config, assertReady } = require("../config");
const { loadTools, registry } = require("../tools");
const agent = require("../core/agent");
const memory = require("../core/memory");
const goalRunner = require("../core/goal");
const audit = require("../core/audit");
const { improve } = require("../prompt/improver");

loadTools();

const VERSION = "0.1.0";
const clients = new Set();
const pendingConfirms = new Map();
let confirmSeq = 0;

function sendEvent(obj) {
  const data = "data: " + JSON.stringify(obj) + "\n\n";
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** A confirm gate that blocks until the UI posts /confirm (or times out). */
const RISK_ORDER = { low: 0, medium: 1, high: 2 };

/**
 * @param approveUpTo  'low'|'medium'|'high' — tools at/below this risk are
 *                     auto-approved (used by the voice app); higher-risk tools
 *                     go through the normal confirm flow.
 * @param timeoutMs    How long to wait for the UI (0 = deny immediately).
 */
function makeConfirmGate({ approveUpTo = null, timeoutMs = 60000 } = {}) {
  const cap = approveUpTo && RISK_ORDER[approveUpTo] !== undefined ? RISK_ORDER[approveUpTo] : -1;
  return function confirm(tool, args) {
    if (cap >= 0 && (RISK_ORDER[tool.risk] ?? 0) <= cap) return Promise.resolve(true);
    if (!(timeoutMs > 0)) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = ++confirmSeq;
      const timer = setTimeout(() => {
        pendingConfirms.delete(id);
        resolve(false);
      }, timeoutMs);
      pendingConfirms.set(id, {
        resolve: (approve) => {
          clearTimeout(timer);
          pendingConfirms.delete(id);
          resolve(!!approve);
        },
      });
      sendEvent({ type: "confirm_request", id, tool: tool.name, risk: tool.risk, args });
    });
  };
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  if (req.method === "GET" && p === "/health") {
    return json(res, 200, {
      ok: true,
      version: VERSION,
      model: config.model,
      gateway: config.baseURL,
      hasKey: assertReady().ok,
      tools: registry.list().length,
    });
  }

  if (req.method === "GET" && p === "/tools") {
    return json(
      res,
      200,
      registry.list().map((t) => ({
        name: t.name,
        description: t.description,
        risk: t.risk,
        parameters: t.parameters,
      }))
    );
  }

  if (req.method === "GET" && p === "/audit") {
    return json(res, 200, { entries: audit.read(Number(url.searchParams.get("limit")) || 100) });
  }

  if (req.method === "GET" && p === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("data: " + JSON.stringify({ type: "connected", version: VERSION }) + "\n\n");
    clients.add(res);
    const hb = setInterval(() => {
      try {
        res.write(": hb\n\n");
      } catch {
        clearInterval(hb);
        clients.delete(res);
      }
    }, 20000);
    req.on("close", () => {
      clearInterval(hb);
      clients.delete(res);
    });
    return;
  }

  if (req.method === "POST" && (p === "/ask" || p === "/improve" || p === "/confirm" || p === "/clear" || p === "/goal")) {
    const body = await readBody(req);

    if (p === "/improve") {
      const r = await improve(body.prompt || "", { voice: !!body.voice });
      return json(res, r.ok ? 200 : 400, { improved: r.output, ok: r.ok });
    }

    if (p === "/confirm") {
      const entry = pendingConfirms.get(Number(body.id));
      if (!entry) return json(res, 404, { ok: false, error: "no such pending confirm" });
      entry.resolve(!!body.approve);
      return json(res, 200, { ok: true });
    }

    if (p === "/clear") {
      memory.clear(body.sessionId || "default");
      return json(res, 200, { ok: true });
    }

    const ready = assertReady();

    if (p === "/goal") {
      const objective = String(body.objective || "").trim();
      if (!objective) return json(res, 400, { ok: false, error: "objective is required" });
      if (!ready.ok && !body.dryRun) return json(res, 503, { ok: false, error: ready.problem });
      const ctx = {
        dryRun: !!body.dryRun,
        confirmRisky: body.autoApprove ? false : config.confirmRisky,
        confirm: body.autoApprove ? null : makeConfirmGate(),
        onEvent: sendEvent,
      };
      try {
        const r = await goalRunner.runGoal({ objective, sessionId: body.sessionId || "goal", ctx });
        return json(res, 200, { ok: !r.error, text: r.text, subtasks: r.subtasks, results: r.results });
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
      }
    }

    // POST /ask
    if (!ready.ok && !body.dryRun) return json(res, 503, { ok: false, error: ready.problem });

    let message = String(body.message || "").trim();
    if (!message) return json(res, 400, { ok: false, error: "message is required" });

    let improved = null;
    if (body.improve) {
      const r = await improve(message, { voice: !!body.voice });
      improved = r.output;
      message = r.output;
    }

    const ctx = {
      dryRun: !!body.dryRun,
      voice: !!body.voice,
      confirmRisky: body.autoApprove ? false : config.confirmRisky,
      confirm: body.autoApprove
        ? null
        : makeConfirmGate({
            approveUpTo: body.approveUpTo || null,
            timeoutMs: Number.isFinite(Number(body.confirmTimeoutMs)) ? Number(body.confirmTimeoutMs) : 60000,
          }),
      onEvent: sendEvent,
    };

    try {
      const result = await agent.runTurn({
        userMessage: message,
        sessionId: body.sessionId || "default",
        ctx,
      });
      return json(res, 200, {
        ok: true,
        text: result.text,
        steps: result.steps,
        trace: result.trace,
        improved,
      });
    } catch (e) {
      sendEvent({ type: "error", error: String(e && e.message ? e.message : e) });
      return json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  return json(res, 404, { ok: false, error: "not found" });
}

function start({ host = config.apiHost, port = config.apiPort } = {}) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      try {
        json(res, 500, { ok: false, error: String(e && e.message ? e.message : e) });
      } catch {}
    });
  });
  server.listen(port, host, () => {
    console.log(`\nNova API listening on http://${host}:${port}`);
    console.log(`  GET  /health /tools /events(SSE)`);
    console.log(`  POST /ask /improve /confirm /clear`);
    console.log(`  model: ${config.model}   tools: ${registry.list().length}\n`);
  });
  return server;
}

module.exports = { start, sendEvent };
