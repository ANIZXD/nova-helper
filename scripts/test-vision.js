/**
 * Probe which OmniRoute models accept image input (vision).
 * Run: node scripts/test-vision.js
 */
const v = require("../src/tools/vision");

const CANDIDATES = [
  "github/gpt-4o-2024-11-20",
  "github/gpt-4o-mini",
  "github/gemini-3.1-pro-preview",
  "github/claude-sonnet-4.5",
  "github/claude-opus-4.5",
  "codex/gpt-5.6-sol",
];

(async () => {
  const img = await v.capture("primary");
  if (!img) {
    console.log("capture failed");
    return;
  }
  console.log("captured:", img, "\n");
  for (const m of CANDIDATES) {
    try {
      const ans = await v.askVision({ prompt: "Reply with the single word: VISION_OK", imagePath: img, model: m });
      console.log(`OK   ${m} -> ${String(ans).slice(0, 80).replace(/\n/g, " ")}`);
    } catch (e) {
      console.log(`FAIL ${m} -> ${String(e.message).slice(0, 120)}`);
    }
  }
})();
