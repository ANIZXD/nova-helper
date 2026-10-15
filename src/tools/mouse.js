"use strict";

const { ps } = require("../util/shell");

/**
 * Mouse control via user32 P/Invoke (SetCursorPos + mouse_event).
 * SetProcessDPIAware() is called first so screen coordinates match the
 * physical pixels returned by screenshots (important on scaled displays).
 */

const SIG =
  '[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y); ' +
  '[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);';

function invoke(body) {
  // NOTE: deliberately NOT calling SetProcessDPIAware(). Screen captures come
  // from a DPI-unaware process (logical pixels), so the mouse must use the same
  // logical coordinate space or clicks would be off on scaled displays.
  return `$sig='${SIG}'; $m=Add-Type -MemberDefinition $sig -Name M -Namespace Nova -PassThru; ${body}`;
}

const FLAG = { left: [0x02, 0x04], right: [0x08, 0x10], middle: [0x20, 0x40] };

async function moveMouse({ x, y }) {
  if (x == null || y == null) return { ok: false, output: "'x' and 'y' are required" };
  const r = await ps(invoke(`$m::SetCursorPos(${Number(x)},${Number(y)})`), { timeoutMs: 10000 });
  return { ok: r.code === 0, output: r.code === 0 ? `Mouse moved to (${Number(x)},${Number(y)})` : r.stderr.trim() };
}

async function click({ x, y, button = "left", double = false }) {
  const [down, up] = FLAG[String(button).toLowerCase()] || FLAG.left;
  const pre = x != null && y != null ? `$m::SetCursorPos(${Number(x)},${Number(y)}); Start-Sleep -Milliseconds 60; ` : "";
  const one = `$m::mouse_event(${down},0,0,0,[UIntPtr]::Zero); $m::mouse_event(${up},0,0,0,[UIntPtr]::Zero); `;
  const body = pre + one + (double ? `Start-Sleep -Milliseconds 80; ${one}` : "");
  const r = await ps(invoke(body), { timeoutMs: 10000 });
  return {
    ok: r.code === 0,
    output: r.code === 0 ? `${double ? "Double-c" : "C"}licked ${button}${x != null ? ` at (${Number(x)},${Number(y)})` : ""}` : r.stderr.trim(),
  };
}

async function scroll({ amount = 3 }) {
  const n = Number(amount) || 0;
  const delta = Math.round(n * 120); // positive = up, negative = down
  const r = await ps(invoke(`$m::mouse_event(0x0800,0,0,${delta},[UIntPtr]::Zero)`), { timeoutMs: 10000 });
  return { ok: r.code === 0, output: r.code === 0 ? `Scrolled ${n > 0 ? "up" : "down"} ${Math.abs(n)}` : r.stderr.trim() };
}

async function mousePos() {
  const r = await ps(
    "Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; Write-Output ($p.X.ToString()+','+$p.Y.ToString())",
    { timeoutMs: 10000 }
  );
  if (r.code !== 0) return { ok: false, output: r.stderr.trim() };
  const [x, y] = r.stdout.trim().split(",").map(Number);
  return { ok: true, output: `Mouse at (${x},${y})`, data: { x, y } };
}

async function drag({ fromX, fromY, toX, toY, button = "left" }) {
  if ([fromX, fromY, toX, toY].some((v) => v == null)) return { ok: false, output: "fromX/fromY/toX/toY are required" };
  const [down, up] = FLAG[String(button).toLowerCase()] || FLAG.left;
  const body =
    `$m::SetCursorPos(${Number(fromX)},${Number(fromY)}); Start-Sleep -Milliseconds 80; ` +
    `$m::mouse_event(${down},0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; ` +
    `$m::SetCursorPos(${Number(toX)},${Number(toY)}); Start-Sleep -Milliseconds 80; ` +
    `$m::mouse_event(${up},0,0,0,[UIntPtr]::Zero)`;
  const r = await ps(invoke(body), { timeoutMs: 10000 });
  return { ok: r.code === 0, output: r.code === 0 ? `Dragged to (${Number(toX)},${Number(toY)})` : r.stderr.trim() };
}

module.exports = {
  tools: [
    {
      name: "mouse_move",
      description: "Move the mouse pointer to screen coordinates (x, y).",
      risk: "low",
      parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
      execute: moveMouse,
    },
    {
      name: "mouse_click",
      description: "Click the mouse, optionally at coordinates. button: left|right|middle; double: true for double-click.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" }, button: { type: "string" }, double: { type: "boolean" } },
      },
      execute: click,
    },
    {
      name: "mouse_scroll",
      description: "Scroll the mouse wheel (positive = up, negative = down).",
      risk: "low",
      parameters: { type: "object", properties: { amount: { type: "number" } } },
      execute: scroll,
    },
    {
      name: "mouse_pos",
      description: "Get the current mouse pointer coordinates.",
      risk: "low",
      parameters: { type: "object", properties: {} },
      execute: mousePos,
    },
    {
      name: "mouse_drag",
      description: "Drag from one coordinate to another.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { fromX: { type: "number" }, fromY: { type: "number" }, toX: { type: "number" }, toY: { type: "number" } },
        required: ["fromX", "fromY", "toX", "toY"],
      },
      execute: drag,
    },
  ],
};
