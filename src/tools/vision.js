"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { config } = require("../config");
const { ps } = require("../util/shell");

/**
 * Vision — gives Nova eyes.
 *
 * Captures the screen and sends the image to a vision-capable model through
 * OmniRoute, returning a text description / answer. This is what enables
 * "what's on my screen?", "click the blue button" (see it, then mouse_click the
 * coordinates it reports), and reading text from an app that has no API.
 */

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

async function capture(monitor) {
  const dir = path.join(config.paths.data, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `see-${Date.now()}.png`);
  const bounds =
    String(monitor || "all").toLowerCase() === "primary"
      ? "[System.Windows.Forms.Screen]::PrimaryScreen.Bounds"
      : "[System.Windows.Forms.SystemInformation]::VirtualScreen";
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
    `$b=${bounds}; if(-not $b){ throw 'no bounds' }; ` +
    "$bmp=New-Object System.Drawing.Bitmap([int]$b.Width,[int]$b.Height); " +
    "$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Left,$b.Top,0,0,$bmp.Size); " +
    `$bmp.Save(${psQuote(out)},[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()`;
  const r = await ps(script, { timeoutMs: 30000 });
  if (r.code !== 0 || !fs.existsSync(out)) return null;
  return out;
}

async function askVision({ prompt, imagePath, model }) {
  const b64 = fs.readFileSync(imagePath).toString("base64");
  const body = {
    model: model || config.visionModel,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: "data:image/png;base64," + b64 } },
        ],
      },
    ],
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(config.baseURL.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`vision HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  } finally {
    clearTimeout(timer);
  }
}

async function seeScreen({ question, monitor = "primary", keep }) {
  const shot = await capture(monitor);
  if (!shot) return { ok: false, output: "Could not capture the screen." };
  const q =
    question ||
    "Describe what is currently on this screen. If the user seems to want to click something, list any obvious buttons/links with their approximate pixel coordinates (x,y) relative to the top-left of the image.";
  try {
    const answer = await askVision({ prompt: q, imagePath: shot });
    if (!keep) {
      try {
        fs.unlinkSync(shot);
      } catch {}
    }
    return { ok: true, output: (answer || "").trim() || "(no description)", data: { image: keep ? shot : undefined } };
  } catch (e) {
    return { ok: false, output: `Vision failed: ${e && e.message ? e.message : e}`, data: { image: shot } };
  }
}

module.exports = {
  capture,
  askVision,
  tools: [
    {
      name: "see_screen",
      description:
        "Take a screenshot and have a vision model describe/answer a question about it. " +
        "Use for 'what's on my screen?', reading a dialog, or finding where to click (it can report pixel coordinates).",
      risk: "low",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "What to ask about the screen." },
          monitor: { type: "string", description: "'primary' (default) or 'all'" },
          keep: { type: "boolean", description: "Keep the screenshot file (default false)." },
        },
      },
      execute: seeScreen,
    },
  ],
};
