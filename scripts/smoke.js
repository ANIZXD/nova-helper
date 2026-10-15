/**
 * Smoke test — exercises the safe tools directly (no LLM, no risky actions).
 * Run: node scripts/smoke.js
 */
require("../src/tools").loadTools();
const r = require("../src/tools/registry");

const CASES = [
  ["system_info", {}],
  ["get_time", {}],
  ["screenshot", { monitor: "primary" }],
  ["screenshot", { monitor: "all" }],
  ["list_windows", {}],
  ["list_processes", { limit: 3 }],
  ["volume_get", {}],
  ["volume_set", { percent: 30 }],
  ["volume_up", { percent: 5 }],
  ["volume_down", { percent: 5 }],
  ["volume_mute", { muted: false }],
  ["clipboard_set", { text: "nova-clipboard-test" }],
  ["clipboard_get", {}],
  ["list_dir", { path: "C:\\Users\\ay660\\nova" }],
  ["read_file", { path: "C:\\Users\\ay660\\nova\\package.json" }],
  ["make_dir", { path: "C:\\Users\\ay660\\.nova\\smoke-test-dir" }],
  ["notify", { title: "Nova", message: "Smoke test" }],
  ["wait", { seconds: 1 }],
];

(async () => {
  let pass = 0;
  let fail = 0;
  for (const [name, args] of CASES) {
    const started = Date.now();
    let res;
    try {
      res = await r.run(name, args, { confirmRisky: false });
    } catch (e) {
      res = { ok: false, output: "threw: " + e.message };
    }
    const ms = Date.now() - started;
    const ok = res.ok;
    ok ? pass++ : fail++;
    const first = String(res.output || "").split("\n").slice(0, 3).join(" | ").slice(0, 140);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(16)} ${String(ms).padStart(5)}ms  ${first}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
