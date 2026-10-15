"use strict";

const { ps } = require("../util/shell");
const { focusWindow } = require("./window");

/**
 * Keyboard automation via System.Windows.Forms.SendKeys.
 * SendKeys types into the currently FOCUSED window — so pass windowTitle to
 * focus first, or use focus_window before typing.
 */

/** Escape a literal string so SendKeys types it verbatim. */
function escapeSendKeys(text) {
  return String(text)
    .replace(/\r?\n/g, "{ENTER}")
    .replace(/\{/g, "{{")
    .replace(/\}/g, "}}")
    .replace(/\+/g, "{+}")
    .replace(/\^/g, "{^}")
    .replace(/%/g, "{%}")
    .replace(/~/g, "{~}")
    .replace(/\(/g, "{(}")
    .replace(/\)/g, "{)}");
}

/** Escape for embedding inside a PowerShell single-quoted string. */
function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

const KEY_ALIASES = {
  enter: "{ENTER}",
  return: "{ENTER}",
  tab: "{TAB}",
  esc: "{ESC}",
  escape: "{ESC}",
  space: " ",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  backspace: "{BS}",
  delete: "{DEL}",
  del: "{DEL}",
  home: "{HOME}",
  end: "{END}",
  pgup: "{PGUP}",
  pgdn: "{PGDN}",
  ctrl: "{CTRL}",
  alt: "{ALT}",
  shift: "{SHIFT}",
  win: "{LWIN}",
  alttab: "%{TAB}",
  altdown: "%{DOWN}",
  altup: "%{UP}",
  ctrlc: "^c",
  ctrlv: "^v",
  ctrla: "^a",
  ctrlz: "^z",
  ctrly: "^y",
  ctrlx: "^x",
  ctrls: "^s",
  wind: "{LWIN}d",
};

async function typeText({ text, windowTitle, method = "sendkeys", delayMs = 300 }) {
  if (!text) return { ok: false, output: "'text' is required" };

  if (windowTitle) {
    const f = await focusWindow({ title_contains: windowTitle });
    if (!f.ok) return f;
  }

  const sleep = Math.max(0, Math.min(5000, Number(delayMs) || 0));
  let body;

  if (String(method).toLowerCase() === "clipboard") {
    // More reliable for long/arbitrary text: put it on the clipboard and paste.
    body = `Set-Clipboard -Value ${psQuote(String(text))}; Start-Sleep -Milliseconds ${sleep}; [System.Windows.Forms.SendKeys]::SendWait('^v')`;
  } else {
    body = `[System.Windows.Forms.SendKeys]::SendWait(${psQuote(escapeSendKeys(text))})`;
  }

  const cmd = `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds ${sleep}; ${body}`;
  const r = await ps(cmd, { timeoutMs: 20000 });
  return {
    ok: r.code === 0,
    output: r.code === 0 ? `Typed ${String(text).length} chars (${method})` : `Type failed: ${r.stderr.trim()}`,
  };
}

async function sendKeys({ keys, windowTitle, delayMs = 200 }) {
  if (!keys) return { ok: false, output: "'keys' is required (SendKeys syntax, e.g. ^a, {ENTER})" };
  if (windowTitle) {
    const f = await focusWindow({ title_contains: windowTitle });
    if (!f.ok) return f;
  }
  const sleep = Math.max(0, Math.min(5000, Number(delayMs) || 0));
  const r = await ps(
    `Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds ${sleep}; ` +
      `[System.Windows.Forms.SendKeys]::SendWait(${psQuote(keys)})`,
    { timeoutMs: 20000 }
  );
  return { ok: r.code === 0, output: r.code === 0 ? `Sent keys: ${keys}` : `SendKeys failed: ${r.stderr.trim()}` };
}

async function pressKey({ key }) {
  if (!key) return { ok: false, output: "'key' is required" };
  const token = KEY_ALIASES[String(key).toLowerCase()] || `{${String(key).toUpperCase()}}`;
  return sendKeys({ keys: token });
}

module.exports = {
  tools: [
    {
      name: "type_text",
      description:
        "Type literal text into the focused window (optionally focus a window first via windowTitle). " +
        "Uses 'clipboard' method for long or special-character text.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          windowTitle: { type: "string", description: "Focus this window first (title substring)." },
          method: { type: "string", description: "sendkeys (default) | clipboard" },
          delayMs: { type: "number", description: "Delay before typing (default 300)." },
        },
        required: ["text"],
      },
      execute: typeText,
    },
    {
      name: "send_keys",
      description:
        "Send SendKeys syntax to the focused window. e.g. ^a (ctrl+a), {ENTER}, %{TAB} (alt+tab), ^v.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          keys: { type: "string" },
          windowTitle: { type: "string" },
          delayMs: { type: "number" },
        },
        required: ["keys"],
      },
      execute: sendKeys,
    },
    {
      name: "press_key",
      description: "Press a named key: enter, tab, esc, space, up/down/left/right, backspace, delete, home, end, ctrlc, ctrlv, wind (win+d), alttab…",
      risk: "medium",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string" },
          windowTitle: { type: "string" },
        },
        required: ["key"],
      },
      execute: pressKey,
    },
  ],
};
