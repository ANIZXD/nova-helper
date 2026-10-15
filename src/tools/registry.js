"use strict";

/**
 * Tool registry — the contract every Nova capability implements.
 *
 * A tool is: { name, description, parameters, risk, execute }
 *   parameters : JSON Schema (object) handed to the LLM for function-calling
 *   risk       : 'low' (safe/reversible) | 'medium' | 'high' (destructive / hard to undo)
 *   execute    : async (args, ctx) => { ok, output, data? }
 *
 * The agent loop calls registry.run(), which enforces dry-run and risk gating.
 * ctx.confirm (optional) is provided by the caller (CLI prompt, or the UI's confirm hook).
 */

const tools = new Map();

const RISK_ORDER = { low: 0, medium: 1, high: 2 };

function register(tool) {
  if (!tool || !tool.name) throw new Error("tool.name is required");
  if (typeof tool.execute !== "function") throw new Error(`tool ${tool.name}: execute() required`);
  if (!tool.parameters) tool.parameters = { type: "object", properties: {} };
  if (!tool.risk) tool.risk = "low";
  if (RISK_ORDER[tool.risk] === undefined) throw new Error(`tool ${tool.name}: bad risk '${tool.risk}'`);
  tools.set(tool.name, tool);
  return tool;
}

function registerAll(list) {
  for (const t of list) register(t);
  return list;
}

function get(name) {
  return tools.get(name) || null;
}

function list() {
  return [...tools.values()];
}

/** Format for OpenAI-style function calling. */
function toOpenAITools() {
  return list().map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Execute a tool with safety enforced.
 * @returns { ok, skipped?, reason?, output, data? }
 */
async function run(name, args, ctx = {}) {
  const tool = tools.get(name);
  if (!tool) return { ok: false, reason: `unknown tool '${name}'` };

  const dryRun = ctx.dryRun === true || (ctx.dryRun == null && process.env.NOVA_DRY_RUN === "1");

  if (dryRun) {
    return {
      ok: true,
      skipped: true,
      reason: "dry-run",
      output: `[dry-run] would call ${name}(${JSON.stringify(args || {})})`,
    };
  }

  // Risk gate: medium/high tools need confirmation unless explicitly allowed.
  if (RISK_ORDER[tool.risk] > 0 && ctx.confirmRisky !== false) {
    const approve = ctx.confirm ? await ctx.confirm(tool, args) : false;
    if (!approve) {
      return {
        ok: false,
        skipped: true,
        reason: "not-confirmed",
        output: `User declined the risky action ${name}(${JSON.stringify(args || {})}).`,
      };
    }
  }

  try {
    const result = (await tool.execute(args || {}, ctx)) || {};
    if (result.ok === undefined) result.ok = true;
    if (result.output === undefined) result.output = "";
    return result;
  } catch (e) {
    return {
      ok: false,
      reason: "exception",
      output: `Tool ${name} threw: ${e && e.message ? e.message : String(e)}`,
    };
  }
}

module.exports = {
  register,
  registerAll,
  get,
  list,
  run,
  toOpenAITools,
};
