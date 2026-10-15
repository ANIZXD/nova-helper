"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { config } = require("../config");
const planner = require("./planner");
const registry = require("../tools/registry");
const memory = require("./memory");
const audit = require("./audit");

const SYSTEM_PROMPT = `You are Nova, a hands-free personal assistant that controls the user's Windows 11 computer.
You are precise, concise, and safe.

How you work:
- You are given tools. Use them to actually perform the user's request on their PC.
- Think step by step, but only call the tools you need.
- Prefer the narrowest, safest tool that does the job. Never use run_command when a dedicated tool exists.
- You may call several tools in one step when the actions are independent.
- After tools run, you receive their results. Then either do the next step or reply with a short summary.
- Only stop and answer when the task is complete.

Safety:
- 'run_command', 'delete_path', 'kill_process', 'window_state(close)', 'sleep_pc' are destructive. Use only when clearly necessary.
- If a tool returns ok:false or a 'not-confirmed' result, do NOT retry the same thing blindly; adapt or explain.
- Never invent tool results. If you don't know, call a tool to find out.

Style:
- Reply in the user's language, briefly. No filler, no bullet-point walls unless asked.
- If you could not do something, say what failed and why in one line.`;

const MAX_TOOL_OUTPUT = 4000; // chars fed back to the model

/**
 * Appended to the system prompt when the request came in through the voice app.
 */
const VOICE_PROMPT =
  "\n\nVoice mode: the user SPOKE this request, so the transcription may contain " +
  "misheard or missing words (names, numbers, app names). Interpret it charitably " +
  "against the tools you have. Your reply is read aloud by a text-to-speech voice, so " +
  "answer in 1-3 short plain sentences: no markdown, no bullet lists, no code blocks, " +
  "no file dumps, and read numbers/units naturally. Only if the intent is truly " +
  "ambiguous, ask one short clarifying question instead of guessing.";

/**
 * Real environment facts injected into the system prompt so the model uses
 * correct paths instead of inventing placeholders like C:\Users\User\...
 */
let _envCache = null;
function envContext() {
  if (_envCache) return _envCache;
  const home = os.homedir();
  const pick = (...cands) => cands.find((p) => p && fs.existsSync(p)) || cands[0];
  const desktop = pick(
    path.join(home, "Desktop"),
    process.env.OneDrive && path.join(process.env.OneDrive, "Desktop"),
    process.env.OneDriveConsumer && path.join(process.env.OneDriveConsumer, "Desktop")
  );
  const oneDrive = process.env.OneDrive || process.env.OneDriveConsumer || null;
  _envCache = [
    `Current date & time: ${new Date().toString()}`,
    `OS: ${os.type()} ${os.release()} (${process.platform})`,
    `User home: ${home}`,
    `Desktop: ${desktop}`,
    `Documents: ${pick(path.join(home, "Documents"), oneDrive && path.join(oneDrive, "Documents"))}`,
    `Downloads: ${pick(path.join(home, "Downloads"), oneDrive && path.join(oneDrive, "Downloads"))}`,
    `Nova data dir: ${config.paths.data}`,
    `Working directory: ${process.cwd()}`,
  ].join("\n");
  return _envCache;
}

function truncate(s) {
  const str = String(s == null ? "" : s);
  return str.length > MAX_TOOL_OUTPUT ? str.slice(0, MAX_TOOL_OUTPUT) + `\n…[truncated ${str.length - MAX_TOOL_OUTPUT} chars]` : str;
}

function sig(name, args) {
  try {
    return name + ":" + JSON.stringify(args);
  } catch {
    return name + ":?";
  }
}

/**
 * Execute one agent turn.
 * @returns { text, trace, steps, done, model }
 */
async function runTurn({ userMessage, sessionId = "default", ctx = {} }) {
  const emit = ctx.onEvent || (() => {});
  const prior = memory.getMessages(sessionId);
  let system =
    SYSTEM_PROMPT + "\n\nEnvironment (use these real paths, never invent placeholders):\n" + envContext();
  if (ctx.voice) system += VOICE_PROMPT;
  const messages = [
    { role: "system", content: system },
    ...prior,
    { role: "user", content: userMessage },
  ];

  const tools = registry.toOpenAITools();
  const trace = [];
  let steps = 0;
  let model = null;
  const succeeded = new Set(); // signatures that already ran OK (loop guard)
  // Dry runs must not pollute real memory.
  const remember = (user, asst) => {
    if (!ctx.dryRun) memory.append(sessionId, { role: "user", content: user }, { role: "assistant", content: asst });
  };

  for (let step = 0; step < config.maxSteps; step++) {
    steps++;
    emit({ type: "step", step: step + 1 });

    let msg;
    try {
      msg = await planner.chat({ messages, tools });
    } catch (e) {
      const text = `I couldn't reach the model: ${e && e.message ? e.message : e}`;
      emit({ type: "error", error: text });
      remember(userMessage, text);
      return { text, trace, steps, done: false, error: true, model };
    }
    model = msg._model || model;

    const toolCalls = msg.tool_calls || [];
    if (!toolCalls.length) {
      const text = (msg.content || "").trim();
      remember(userMessage, text);
      emit({ type: "final", text });
      return { text, trace, steps, done: true, model };
    }

    messages.push(msg);

    for (const tc of toolCalls) {
      const name = tc.function && tc.function.name;
      let args = {};
      try {
        args = JSON.parse((tc.function && tc.function.arguments) || "{}");
      } catch {
        args = {};
      }

      // Loop guard: if the model repeats an already-successful call, short-circuit.
      const s = sig(name, args);
      if (succeeded.has(s)) {
        const note = `Skipped duplicate call to ${name} (already succeeded).`;
        trace.push({ name, args, ok: true, skipped: true, output: note });
        emit({ type: "tool_result", name, ok: true, skipped: true, output: note });
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: true, skipped: true, output: note }) });
        continue;
      }

      emit({ type: "tool_call", name, args });
      audit.record({ session: sessionId, tool: name, args, risk: (registry.get(name) || {}).risk });
      const result = await registry.run(name, args, {
        ...ctx,
        dryRun: ctx.dryRun,
        confirmRisky: ctx.confirmRisky,
      });
      if (result.ok) succeeded.add(s);
      audit.record({
        session: sessionId,
        tool: name,
        args,
        ok: result.ok,
        skipped: !!result.skipped,
        output: String(result.output || "").slice(0, 500),
      });

      trace.push({ name, args, ok: result.ok, skipped: result.skipped, output: result.output });
      emit({ type: "tool_result", name, ok: result.ok, skipped: result.skipped, output: result.output });

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({
          ok: result.ok,
          skipped: !!result.skipped,
          output: truncate(result.output),
          data: result.data,
        }),
      });
    }
  }

  // Ran out of steps — ask the model to wrap up once.
  try {
    const wrap = await planner.chat({
      messages: [...messages, { role: "user", content: "Stop calling tools now and summarize what you did so far." }],
    });
    const text = (wrap.content || "Reached the step limit.").trim();
    remember(userMessage, text);
    emit({ type: "final", text });
    return { text, trace, steps, done: false, truncated: true, model };
  } catch (e) {
    const text = `Reached the step limit. ${e && e.message ? e.message : ""}`.trim();
    emit({ type: "final", text });
    return { text, trace, steps, done: false, truncated: true, model };
  }
}

module.exports = { runTurn, SYSTEM_PROMPT };
