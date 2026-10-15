"use strict";

/**
 * Nova configuration.
 *
 * Resolves, in priority order:
 *   1. process.env
 *   2. <project>/.env
 *   3. sensible defaults
 *
 * The OmniRoute key is resolved from (first match wins):
 *   OMNIROUTE_API_KEY / NOVA_OMNIROUTE_KEY  ->  nova/.env  ->  ~/.claude/settings.json
 *   env.ANTHROPIC_AUTH_TOKEN (same key the user already uses for Claude Code)
 *
 * The key is NEVER logged and NEVER printed.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.NOVA_DATA_DIR || path.join(os.homedir(), ".nova");

// --- tiny .env loader (no dependencies) ------------------------------------
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const fileEnv = loadDotEnv(path.join(PROJECT_ROOT, ".env"));
function env(name, fallback) {
  if (process.env[name] != null && process.env[name] !== "") return process.env[name];
  if (fileEnv[name] != null && fileEnv[name] !== "") return fileEnv[name];
  return fallback;
}

function envBool(name, fallback) {
  const v = env(name, null);
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

/** Read the API key from Claude Code's settings as a last-resort fallback. */
function keyFromClaudeSettings() {
  try {
    const p = path.join(os.homedir(), ".claude", "settings.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return (j && j.env && j.env.ANTHROPIC_AUTH_TOKEN) || null;
  } catch {
    return null;
  }
}

function resolveApiKey() {
  return (
    env("OMNIROUTE_API_KEY", null) ||
    env("NOVA_OMNIROUTE_KEY", null) ||
    keyFromClaudeSettings() ||
    null
  );
}

const config = {
  // OmniRoute (the local OpenAI-compatible gateway). Free models live here.
  baseURL: env("OMNIROUTE_URL", "http://127.0.0.1:20128/v1"),
  apiKey: resolveApiKey(),
  model: env("NOVA_MODEL", "github/gpt-4o-mini"),
  // Model used for "improve my raw prompt" — cheap + fast is fine.
  improverModel: env("NOVA_IMPROVER_MODEL", "github/gpt-4o-mini"),
  // Tried in order if the primary model errors or is rate-limited.
  modelFallbacks: env("NOVA_MODEL_FALLBACKS", "github/gpt-4o-2024-11-20,ddgw/gpt-4o-mini")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Vision-capable model (for see_screen).
  visionModel: env("NOVA_VISION_MODEL", "github/gpt-4o-2024-11-20"),

  // Agent behaviour
  maxSteps: Number(env("NOVA_MAX_STEPS", "12")),
  temperature: Number(env("NOVA_TEMPERATURE", "0.2")),
  // When true, risky tools must be confirmed (via the UI's confirm hook / CLI prompt).
  confirmRisky: envBool("NOVA_CONFIRM_RISKY", true),
  // When true, no tool ever executes (safe preview mode).
  dryRun: envBool("NOVA_DRY_RUN", false),

  // HTTP API (what your UI talks to)
  apiHost: env("NOVA_API_HOST", "127.0.0.1"),
  apiPort: Number(env("NOVA_API_PORT", "20129")),

  paths: {
    root: PROJECT_ROOT,
    data: DATA_DIR,
    thread: path.join(DATA_DIR, "thread.jsonl"),
    sessions: path.join(DATA_DIR, "sessions"),
    audit: path.join(DATA_DIR, "audit.log"),
  },

  // Agent CLIs we can spawn
  binaries: {
    opencode: env(
      "NOVA_OPENCODE",
      path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "@opencode", "cli", "bin", "opencode.exe")
    ),
    claude: env(
      "NOVA_CLAUDE",
      path.join(os.homedir(), "AppData", "Roaming", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
    ),
    code: env("NOVA_CODE", "code"),
  },
};

/** Guard: warn (never print the key itself) if we can't reach a provider. */
function assertReady() {
  if (!config.apiKey) {
    return {
      ok: false,
      problem:
        "No OmniRoute API key found. Set OMNIROUTE_API_KEY in nova/.env " +
        "(OmniRoute requires a key since it was hardened).",
    };
  }
  return { ok: true };
}

module.exports = { config, assertReady, env, envBool, DATA_DIR, PROJECT_ROOT };
