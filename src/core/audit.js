"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { config } = require("../config");

/**
 * Append-only audit log (JSONL) of every tool call Nova performs.
 * Never store secrets here — callers pass a redacted view.
 */

function record(entry) {
  try {
    fs.mkdirSync(path.dirname(config.paths.audit), { recursive: true });
    fs.appendFileSync(config.paths.audit, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch {
    /* auditing must never break a task */
  }
}

function read(limit = 100) {
  try {
    if (!fs.existsSync(config.paths.audit)) return [];
    const lines = fs.readFileSync(config.paths.audit, "utf8").trim().split(/\r?\n/);
    return lines
      .slice(-limit)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { record, read };
