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

/**
 * Voice-mode repair prompt: the transcript is SHORT and may contain misheard
 * words. We give the model Nova's vocabulary so it repairs likely mis-hears
 * (e.g. "better reliable" -> "battery") instead of asking for clarification.
 */
const VOICE_SYSTEM = `You are Nova's speech-repair module for a Windows PC voice assistant. You are given a SHORT, noisy transcript of something the user SPOKE to Nova. Repair likely misheard words, then output a clean, one-line instruction.

What Nova can do (your vocabulary for repairs):
- volume: turn it up / down, mute / unmute, set to N percent
- battery level, current time / date, general system info
- take a screenshot
- open an app (notepad, chrome, calc, code/vscode, explorer, any .exe), open a url, open a folder
- media: play / pause, next track, previous track, stop
- windows: list, focus, minimize, maximize, restore, close
- files: read, write, list, copy, move, delete
- processes: list, kill
- send a message in WhatsApp / Discord / Telegram / Slack
- mouse: move, click, scroll, drag  |  keyboard: type text, press a key
- web search (google / youtube / github)  |  coding agents (opencode, claude)

Rules:
- Fix probable misheard words toward these concepts using context. Common ones:
  "better reliable"/"battery" -> battery   "screen shot" -> screenshot
  "volume don't" -> volume down   "set the volume to 50%" -> set the volume to 50 percent
  "open excel" -> open excel   "tor kyō"/"tokyo" -> tokyo
- NEVER invent a new action the the user did not ask for.
- NEVER ask for clarification — make the single most likely repair.
- Keep it in the same language the user used.
- Output ONLY the repaired instruction, one line, no markdown, no commentary.`;

/** Turn a rough spoken ask into a sharp, actionable instruction. */
async function improve(raw, { voice = false } = {}) {
  if (!raw || !String(raw).trim()) return { ok: false, output: "empty prompt" };
  try {
    const improved = await planner.complete({
      prompt: String(raw),
      system: voice ? VOICE_SYSTEM : SYSTEM,
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
