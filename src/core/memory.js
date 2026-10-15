"use strict";

/**
 * Conversation memory.
 *
 * In-memory per session, with optional persistence to ~/.nova/sessions/<id>.json
 * so a UI can resume a thread across restarts.
 */

const fs = require("node:fs");
const path = require("node:path");
const { config } = require("../config");

const MAX_MESSAGES = 40;
const sessions = new Map();

function fileFor(id) {
  return path.join(config.paths.sessions, `${id}.json`);
}

function load(id) {
  if (sessions.has(id)) return sessions.get(id);
  try {
    const p = fileFor(id);
    const arr = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
    sessions.set(id, arr);
    return arr;
  } catch {
    sessions.set(id, []);
    return [];
  }
}

function save(id, arr) {
  try {
    fs.mkdirSync(config.paths.sessions, { recursive: true });
    fs.writeFileSync(fileFor(id), JSON.stringify(arr.slice(-MAX_MESSAGES)), "utf8");
  } catch {
    /* non-fatal */
  }
}

function getMessages(id) {
  return load(id);
}

function append(id, ...msgs) {
  const arr = load(id);
  for (const m of msgs) arr.push(m);
  if (arr.length > MAX_MESSAGES) arr.splice(0, arr.length - MAX_MESSAGES);
  save(id, arr);
  return arr;
}

function clear(id) {
  sessions.set(id, []);
  save(id, []);
}

module.exports = { getMessages, append, clear, MAX_MESSAGES };
