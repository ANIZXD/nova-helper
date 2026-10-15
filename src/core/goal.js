"use strict";

const { config } = require("../config");
const planner = require("./planner");
const agent = require("./agent");

/**
 * Long-horizon mode.
 *
 * For big objectives ("find a good niche and build a landing page for it"),
 * Nova first decomposes the goal into a short ordered list of concrete,
 * single-turn subtasks, then runs them one by one — carrying the same session
 * memory so each step knows what the previous steps did.
 */

const DECOMPOSE_SYSTEM = `You are Nova's task planner.
Break the user's objective into a short, ordered list of concrete subtasks that a
Windows PC assistant can execute, one per turn, using tools like: open apps/browser,
search the web, read/write files, type/click, take screenshots, and spawn coding
agents (opencode/claude) for dev work.

Rules:
- 3 to 8 subtasks. No more.
- Each subtask must be directly actionable and verifiable.
- Include a final subtask that reports the result to the user.
- Output ONLY the numbered list, one subtask per line, no preamble, no explanation.`;

function parseSubtasks(text) {
  return String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*])\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 8);
}

async function decompose(objective) {
  const text = await planner.complete({
    prompt: objective,
    system: DECOMPOSE_SYSTEM,
    model: config.model,
    temperature: 0.2,
  });
  return parseSubtasks(text);
}

/**
 * @returns { objective, subtasks, results, text }
 */
async function runGoal({ objective, sessionId, ctx = {} }) {
  const emit = ctx.onEvent || (() => {});
  if (!objective || !String(objective).trim()) {
    return { objective, subtasks: [], results: [], text: "No objective given." };
  }
  // Each goal starts with a clean memory unless the caller pins a session id.
  const sid = sessionId || `goal-${Date.now()}`;

  emit({ type: "goal_start", objective });
  let subtasks;
  try {
    subtasks = await decompose(objective);
  } catch (e) {
    return {
      objective,
      subtasks: [],
      results: [],
      text: `Could not plan the goal: ${e && e.message ? e.message : e}`,
      error: true,
    };
  }

  emit({ type: "goal_plan", subtasks });

  const results = [];
  for (let i = 0; i < subtasks.length; i++) {
    const sub = subtasks[i];
    emit({ type: "goal_step", index: i + 1, total: subtasks.length, subtask: sub });
    const r = await agent.runTurn({ userMessage: sub, sessionId: sid, ctx });
    results.push({ subtask: sub, text: r.text, ok: !r.error, steps: r.steps });
    emit({ type: "goal_step_done", index: i + 1, text: r.text, ok: !r.error });
    if (r.error) break; // stop if the model is unreachable
  }

  const text =
    `Goal: ${objective}\n\n` +
    results.map((r, i) => `${i + 1}. ${r.subtask}\n   → ${String(r.text).replace(/\n/g, " ").slice(0, 200)}`).join("\n");

  emit({ type: "goal_done", text });
  return { objective, subtasks, results, text };
}

module.exports = { runGoal, decompose };
