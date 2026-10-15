"use strict";

const { ps } = require("../util/shell");
const { focusWindow } = require("./window");

/**
 * Generic messaging: Nova can't log into every chat app, but it CAN drive the
 * one you already have open/focused. This focuses the target app/window, then
 * pastes the message and (optionally) presses Enter.
 *
 * Covers: "send them this message", "reply", "post this in the chat".
 */

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const SENDKEYS =
  "Add-Type -AssemblyName System.Windows.Forms; " +
  "Start-Sleep -Milliseconds %D%; [System.Windows.Forms.SendKeys]::SendWait('%K%')";

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function sendMessage({ text, app, windowTitle, submit = true, delayMs = 500 }) {
  if (!text) return { ok: false, output: "'text' is required" };

  // 1. Optionally launch the app first.
  if (app) {
    const r = await ps(`Start-Process -FilePath ${psQuote(app)}`, { timeoutMs: 15000 });
    if (r.code !== 0) return { ok: false, output: `Could not launch '${app}': ${r.stderr.trim()}` };
    await sleep(1800); // give it time to appear
  }

  // 2. Focus the target window (by explicit title, else the app name).
  const target = windowTitle || app;
  if (target) {
    const f = await focusWindow({ title_contains: target });
    if (!f.ok) {
      return {
        ok: false,
        output: `Could not find a window matching '${target}'. Open the app/chat first, then retry — or pass windowTitle.`,
      };
    }
  }

  // 3. Put the message on the clipboard and paste it (reliable for any chars).
  const setClip = await ps(`Set-Clipboard -Value ${psQuote(String(text))}`, { timeoutMs: 15000 });
  if (setClip.code !== 0) return { ok: false, output: `Clipboard failed: ${setClip.stderr.trim()}` };

  await sleep(Math.max(0, Math.min(5000, Number(delayMs) || 0)));

  const paste = await ps(SENDKEYS.replace("%D%", "50").replace("%K%", "^v"), { timeoutMs: 15000 });
  if (paste.code !== 0) return { ok: false, output: `Paste failed: ${paste.stderr.trim()}` };

  if (submit) {
    await ps(SENDKEYS.replace("%D%", "150").replace("%K%", "{ENTER}"), { timeoutMs: 15000 });
  }

  return {
    ok: true,
    output: `Typed message${submit ? " and submitted" : " (not sent yet)"} into ${target || "the focused window"}.`,
    data: { target: target || "(focused)", submitted: !!submit, chars: String(text).length },
  };
}

module.exports = {
  tools: [
    {
      name: "send_message",
      description:
        "Send a chat message through an app you already use (WhatsApp/Discord/Telegram/Slack/Messenger…). " +
        "Focuses the app (optionally launches it by name), pastes the text, and presses Enter. " +
        "For it to reach the right person, open that person's chat first.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The message to send." },
          app: { type: "string", description: "Optional app/exe name to launch (e.g. WhatsApp, Discord)." },
          windowTitle: { type: "string", description: "Title substring of the window to type into." },
          submit: { type: "boolean", description: "Press Enter after pasting (default true)." },
        },
        required: ["text"],
      },
      execute: sendMessage,
    },
  ],
};
