"use strict";

const { config } = require("../config");

/**
 * Planner — talks to the local OmniRoute gateway (OpenAI-compatible) using a
 * FREE model, with function-calling to drive the tool registry.
 *
 * Hardened for flaky free providers:
 *   - per-request timeout (AbortController)
 *   - retry with exponential backoff on 429 / 5xx / network errors
 *   - automatic fallback to the next configured model
 */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postOnce({ messages, tools, model, temperature, timeoutMs }) {
  if (!config.apiKey) throw new Error("No OmniRoute API key configured (see src/config.js).");

  const body = { model, messages, temperature };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(config.baseURL.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const err = new Error(`OmniRoute ${res.status} ${res.statusText}: ${txt.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();
    const choice = json.choices && json.choices[0];
    if (!choice) throw new Error("OmniRoute returned no choices");
    const msg = choice.message || {};
    msg._model = json.model || model;
    return msg;
  } finally {
    clearTimeout(timer);
  }
}

/** Retry a single model with backoff. */
async function withRetry(fn, { attempts = 3, baseMs = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retriable = !e.status || e.status === 429 || e.status >= 500 || e.name === "AbortError";
      if (!retriable || i === attempts - 1) break;
      await sleep(baseMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

async function chat({ messages, tools, model, temperature = config.temperature, timeoutMs = 60000 }) {
  const models = [model || config.model, ...(config.modelFallbacks || [])].filter(Boolean);
  const tried = new Set();
  let lastErr;

  for (const m of models) {
    if (tried.has(m)) continue;
    tried.add(m);
    try {
      return await withRetry(() => postOnce({ messages, tools, model: m, temperature, timeoutMs }));
    } catch (e) {
      lastErr = e;
      if (process.env.NOVA_DEBUG) console.error(`[planner] model ${m} failed: ${e.message}`);
    }
  }
  throw lastErr || new Error("All models failed");
}

/** Plain non-tool chat (used by the prompt improver / goal decomposer). */
async function complete({ prompt, system, model, temperature = 0.4 }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const msg = await chat({ messages, model, temperature });
  return (msg.content || "").trim();
}

module.exports = { chat, complete };
