"use strict";

/**
 * Shell / process helpers.
 *
 * Everything Windows-specific goes through PowerShell 5.1 (always present).
 * We deliberately avoid native modules and extra binaries.
 */

const { spawn } = require("node:child_process");

const POWERSHELL =
  process.env.SystemRoot && require("node:fs").existsSync(process.env.SystemRoot + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
    ? process.env.SystemRoot + "\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    : "powershell.exe";

/** Run a command and capture output. Never throws; returns {code,stdout,stderr}. */
function run(file, args, { cwd, timeoutMs = 30000, env } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd: cwd || process.cwd(),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: env ? { ...process.env, ...env } : process.env,
      });
    } catch (e) {
      return resolve({ code: -1, stdout: "", stderr: String(e && e.message) });
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve({ code: -1, stdout, stderr: (stderr + "\n[timed out]").trim() });
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e && e.message) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Run a PowerShell command (already a script block as a string). */
function ps(command, opts = {}) {
  // Force non-terminating errors to become terminating so they surface as a
  // non-zero exit code instead of being silently swallowed.
  const strict = opts.strict === false ? "" : "$ErrorActionPreference='Stop'; ";
  return run(
    POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", strict + command],
    opts
  );
}

/** Spawn something detached and forget about it (for launching apps). */
function spawnDetached(file, args, { cwd, shell = false } = {}) {
  try {
    const child = spawn(file, args, {
      cwd: cwd || process.cwd(),
      detached: true,
      stdio: "ignore",
      shell,
      windowsHide: false,
    });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message) };
  }
}

module.exports = { run, ps, spawnDetached, POWERSHELL };
