"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * File system tools. Reads are low risk; writes are medium; deletes are high.
 * Paths are expanded for ~ and resolved to absolute.
 */

function expand(p) {
  if (!p) return p;
  let s = String(p).trim();
  if (s === "~" || s.startsWith("~/") || s.startsWith("~\\")) {
    s = path.join(require("node:os").homedir(), s.slice(1));
  }
  return path.resolve(s);
}

const MAX_READ = 200 * 1024;

async function readFile({ path: p, maxBytes = MAX_READ, encoding = "utf8" }) {
  const file = expand(p);
  if (!file) return { ok: false, output: "'path' is required" };
  if (!fs.existsSync(file)) return { ok: false, output: `Not found: ${file}` };
  const stat = fs.statSync(file);
  if (stat.isDirectory()) return { ok: false, output: `${file} is a directory (use list_dir).` };
  const cap = Math.min(Number(maxBytes) || MAX_READ, 5 * 1024 * 1024);
  const buf = fs.readFileSync(file);
  const slice = buf.subarray(0, cap);
  const text = slice.toString(encoding === "utf8" ? "utf8" : encoding);
  const truncated = buf.length > cap;
  return {
    ok: true,
    output: text + (truncated ? `\n…[truncated at ${cap} bytes of ${buf.length}]` : ""),
    data: { path: file, bytes: buf.length, truncated },
  };
}

async function writeFile({ path: p, content = "", append = false }) {
  const file = expand(p);
  if (!file) return { ok: false, output: "'path' is required" };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(content), { encoding: "utf8", flag: append ? "a" : "w" });
  return { ok: true, output: `${append ? "Appended to" : "Wrote"} ${file}`, data: { path: file } };
}

async function listDir({ path: p }) {
  const dir = expand(p) || process.cwd();
  if (!fs.existsSync(dir)) return { ok: false, output: `Not found: ${dir}` };
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map((e) => {
    let size = "";
    try {
      if (e.isFile()) size = `${fs.statSync(path.join(dir, e.name)).size}b`;
    } catch {}
    return `${e.isDirectory() ? "[dir] " : "      "}${e.name} ${size}`.trimEnd();
  });
  return { ok: true, output: entries.join("\n") || "(empty)", data: { path: dir, count: entries.length } };
}

async function makeDir({ path: p }) {
  const dir = expand(p);
  if (!dir) return { ok: false, output: "'path' is required" };
  fs.mkdirSync(dir, { recursive: true });
  return { ok: true, output: `Created ${dir}`, data: { path: dir } };
}

async function movePath({ from, to, overwrite = false }) {
  const a = expand(from);
  const b = expand(to);
  if (!a || !b) return { ok: false, output: "'from' and 'to' are required" };
  if (!fs.existsSync(a)) return { ok: false, output: `Not found: ${a}` };
  if (fs.existsSync(b) && !overwrite) return { ok: false, output: `Destination exists: ${b} (pass overwrite:true)` };
  fs.mkdirSync(path.dirname(b), { recursive: true });
  if (fs.existsSync(b) && overwrite) fs.rmSync(b, { recursive: true, force: true });
  fs.renameSync(a, b);
  return { ok: true, output: `Moved ${a} → ${b}` };
}

async function copyPath({ from, to, overwrite = false }) {
  const a = expand(from);
  const b = expand(to);
  if (!a || !b) return { ok: false, output: "'from' and 'to' are required" };
  if (!fs.existsSync(a)) return { ok: false, output: `Not found: ${a}` };
  if (fs.existsSync(b) && !overwrite) return { ok: false, output: `Destination exists: ${b} (pass overwrite:true)` };
  fs.mkdirSync(path.dirname(b), { recursive: true });
  fs.cpSync(a, b, { recursive: true, force: !!overwrite });
  return { ok: true, output: `Copied ${a} → ${b}` };
}

async function deletePath({ path: p, recursive = false }) {
  const target = expand(p);
  if (!target) return { ok: false, output: "'path' is required" };
  if (!fs.existsSync(target)) return { ok: false, output: `Not found: ${target}` };
  const stat = fs.statSync(target);
  if (stat.isDirectory() && !recursive) return { ok: false, output: `${target} is a directory (pass recursive:true).` };
  fs.rmSync(target, { recursive: !!recursive, force: true });
  return { ok: true, output: `Deleted ${target}` };
}

module.exports = {
  tools: [
    {
      name: "read_file",
      description: "Read a text file and return its contents (truncated if huge).",
      risk: "low",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, maxBytes: { type: "number" } },
        required: ["path"],
      },
      execute: readFile,
    },
    {
      name: "write_file",
      description: "Create or overwrite a text file (or append).",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" }, append: { type: "boolean" } },
        required: ["path", "content"],
      },
      execute: writeFile,
    },
    {
      name: "list_dir",
      description: "List the files and folders in a directory.",
      risk: "low",
      parameters: { type: "object", properties: { path: { type: "string" } } },
      execute: listDir,
    },
    {
      name: "make_dir",
      description: "Create a directory (including parents).",
      risk: "low",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: makeDir,
    },
    {
      name: "move_path",
      description: "Move or rename a file or folder.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, overwrite: { type: "boolean" } },
        required: ["from", "to"],
      },
      execute: movePath,
    },
    {
      name: "copy_path",
      description: "Copy a file or folder.",
      risk: "medium",
      parameters: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, overwrite: { type: "boolean" } },
        required: ["from", "to"],
      },
      execute: copyPath,
    },
    {
      name: "delete_path",
      description: "Permanently delete a file or folder. HIGH RISK — cannot be undone.",
      risk: "high",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, recursive: { type: "boolean" } },
        required: ["path"],
      },
      execute: deletePath,
    },
  ],
};
