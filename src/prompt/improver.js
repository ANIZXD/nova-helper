"use strict";

const planner = require("../core/planner");
const { config } = require("../config");

const SYSTEM = `You are Nova's prompt editor. The user gives you a rough, spoken-style instruction for their Windows PC assistant.
Rewrite it into a single, crisp, unambiguous instruction the agent can execute reliably.

Rules:
- Keep the user's exact intent — never drop a requested action.
- Add concrete specifics where they were implied (e.g. "that thing" -> the actual app/url if clear from context).
- If the request is ambiguous, choose the most likely interpretation and state your assumption in ONE short parenthetical.
- If the request needs more than a PC assistant should do silently (destructive, irreversible), prefix it with "[needs confirmation] ".
- Output ONLY the rewritten instruction. No preamble, no explanation, no markdown.`;

/** Turn a rough spoken ask into a sharp, actionable instruction. */
async function improve(raw) {
  if (!raw || !String(raw).trim()) return { ok: false, output: "empty prompt" };
  try {
    const improved = await planner.complete({
      prompt: String(raw),
      system: SYSTEM,
      model: config.improverModel,
      temperature: 0.3,
    });
    return { ok: true, output: improved || String(raw).trim(), original: String(raw).trim() };
  } catch (e) {
    // Degrade gracefully: run with the raw prompt.
    return { ok: false, output: String(raw).trim(), error: String(e && e.message ? e.message : e) };
  }
}

module.exports = { improve };
