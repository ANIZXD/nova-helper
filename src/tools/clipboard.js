"use strict";

const { ps } = require("../util/shell");

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function clipboardSet({ text }) {
  if (text == null) return { ok: false, output: "'text' is required" };
  const r = await ps(`Set-Clipboard -Value ${psQuote(String(text))}`, { timeoutMs: 15000 });
  return { ok: r.code === 0, output: r.code === 0 ? "Clipboard set." : `Failed: ${r.stderr.trim()}` };
}

async function clipboardGet() {
  const r = await ps("Get-Clipboard", { timeoutMs: 15000 });
  return {
    ok: r.code === 0,
    output: r.stdout.trim() || "(clipboard empty)",
    data: { clipboard: r.stdout.replace(/\r?\n$/, "") },
  };
}

module.exports = {
  tools: [
    {
      name: "clipboard_set",
      description: "Put text on the Windows clipboard (then you can paste it with send_keys ^v).",
      risk: "low",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      execute: clipboardSet,
    },
    {
      name: "clipboard_get",
      description: "Read the current Windows clipboard text.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: clipboardGet,
    },
  ],
};
