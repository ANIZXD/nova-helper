# Nova Helper

> A whole-PC assistant engine for Windows. Give it plain language — it plans with an LLM, then actually **does it**: opens apps, edits files, drives keyboard and mouse, controls volume and windows, takes screenshots, and even spawns coding agents to build things for you.

**Runs 100% locally** as a CLI + HTTP/SSE server, so any UI (Electron tray app, browser page, hotkey overlay, Claude, or your own) can drive it. Zero runtime dependencies — just Node.js.

```
PS> nova ask "open notepad, type hello, set volume to 30"
  → open_app({"name":"notepad"})        ok
  → type_text({"text":"hello"})         ok
  → volume_set({"percent":30})          ok
Notepad is open with 'hello' typed, volume is now 30%.
```

---

## Why Nova Helper

| | |
|---|---|
| 🔒 **Safety by design** | 48 tools carry risk levels (`low`/`medium`/`high`). Destructive actions block until confirmed, every call is written to an audit log, and `--dry-run` previews anything without touching your PC. |
| 🧠 **Real agent loop** | Plan → act → observe → replan, with retry/backoff and automatic model fallback when a free provider rate-limits. |
| 🎯 **Correct, not plausible** | It injects your real environment (Desktop path, OneDrive redirects, date, cwd) so it never invents `C:\Users\User\...` placeholders. |
| 🔌 **UI-agnostic** | A tiny HTTP + SSE API with an event stream for live progress and a confirm flow for risky actions. |
| 🪶 **Zero dependencies** | Plain Node.js + PowerShell 5.1 (built into Windows). No Python, no native modules, no extra binaries. |

---

## Quick start

**Requirements:** Windows 10/11 · Node.js 20+ · [OmniRoute](https://github.com/) running locally (provides the LLM).

```powershell
git clone <your-repo-url>
cd nova-helper

npm test                  # verify all 48 tools work on your machine
node src/index.js doctor  # check gateway, API key, model, binaries
npm link                  # optional: installs a global `nova` command
```

Then try it:

```powershell
nova ask --yes "what's my battery level and current volume?"
# (without npm link, use: node src/index.js ask --yes "...")
```

> **First run note:** Nova asks for confirmation before `medium`/`high` risk tools. Pass `--yes` to auto-approve in a session, or build a UI that answers the confirm event.

### CLI

| Command | What it does |
|---|---|
| `nova doctor` | Health check: gateway, key, model, agent binaries |
| `nova tools` | List all 48 capabilities grouped by risk |
| `nova ask "task"` | Run a single task (`--dry-run` `--improve` `--yes` `--session id`) |
| `nova goal "objective"` | Decompose a big objective into subtasks and execute them all |
| `nova chat` | Interactive REPL with session memory |
| `nova serve` | Start the HTTP + SSE API (default `127.0.0.1:20129`) |
| `nova improve "raw ask"` | Show how Nova would sharpen a vague request first |

### Goal mode — the fun one

```powershell
nova goal --yes "Create a folder on my Desktop called NovaDemo, write hello.txt
inside it containing exactly 'hello from Nova', list the contents and report the path"
```

```
Planned subtasks:
  1. Create the folder NovaDemo on the Desktop.
  2. Write hello.txt with the requested content.
  3. List the folder contents.
  4. Report the full path.

[1/4] → make_dir({"path":"C:\Users\you\OneDrive\Desktop\NovaDemo"})   ok
[2/4] → write_file({"content":"hello from Nova", ...})                 ok
...
```

---

## HTTP API (build your UI on this)

```powershell
node src/index.js serve --port 20129
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Gateway status, model, tool count |
| GET | `/tools` | All tool schemas (for building UIs/menus) |
| POST | `/ask` | `{ message, sessionId?, improve?, dryRun?, autoApprove? }` → `{ text, steps, trace }` |
| POST | `/goal` | `{ objective }` → decomposes + executes, streams `goal_*` events |
| POST | `/improve` | `{ prompt }` → rewritten instruction |
| POST | `/confirm` | `{ id, approve }` — answer a pending risky-action prompt |
| GET | `/events` | **SSE stream**: `step`, `tool_call`, `tool_result`, `confirm_request`, `goal_*`, `final`, `error` |
| GET | `/audit` | Recent tool-call audit log |
| POST | `/clear` | Reset session memory |

**Risky-action flow:** the engine pauses and emits `confirm_request` over SSE → your UI shows a dialog → `POST /confirm` → execution continues. Nothing destructive runs without an approval.

Minimal UI you can paste into an `.html` file and open:

```html
<button id=go>Ask Nova</button><pre id=log></pre>
<script>
  const log = (m) => logEl.textContent += m + "\n";
  const logEl = document.getElementById('log');
  new EventSource('http://127.0.0.1:20129/events').onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === "tool_call") log("→ " + ev.name + " " + JSON.stringify(ev.args));
    if (ev.type === "final") log("nova: " + ev.text);
    if (ev.type === "confirm_request") {
      fetch("http://127.0.0.1:20129/confirm", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ev.id, approve: confirm(`Allow ${ev.tool}?`) }) });
    }
  };
  document.getElementById("go").onclick = () =>
    fetch("http://127.0.0.1:20129/ask", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt("What should Nova do?"), sessionId: "ui" }) });
</script>
```

The API binds to `127.0.0.1` only — **it is never exposed to your LAN**.

---

## Tools (48)

| Group | Tools | Risk |
|---|---|---|
| **Apps & web** | `open_app` `open_url` `open_folder` `search_web` | low/med |
| **Keyboard** | `type_text` `send_keys` `press_key` | medium |
| **Mouse** | `mouse_move` `mouse_click` `mouse_drag` `mouse_scroll` `mouse_pos` | low/med |
| **Windows** | `list_windows` `focus_window` `window_state` | low/high |
| **Volume** *(Core Audio, exact)* | `volume_get` `volume_set` `volume_up` `volume_down` `volume_mute` | low |
| **Media** | `media_play_pause` `media_next` `media_prev` `media_stop` | low |
| **Screen** | `screenshot` `notify` | low |
| **System** | `system_info` `get_time` `wait` `lock_pc` `sleep_pc` | low/med/high |
| **Files** | `read_file` `write_file` `list_dir` `make_dir` `move_path` `copy_path` `delete_path` | low/med/high |
| **Processes** | `list_processes` `kill_process` | low/high |
| **Messaging** | `send_message` (focus app → paste → Enter) | medium |
| **Clipboard** | `clipboard_get` `clipboard_set` | low |
| **Coding agents** | `spawn_opencode` `spawn_claude` `dev_task` `run_in_terminal` | medium/high |
| **Arbitrary shell** | `run_command` (PowerShell, last resort) | high |

**Adding your own** is one file + one line:

```js
// src/tools/shutdown.js
module.exports = [{
  name: "shutdown_pc",
  description: "Shut the computer down after N seconds.",
  risk: "high",
  parameters: { type: "object", properties: { delaySeconds: { type: "number" } } },
  async execute({ delaySeconds = 0 }) {
    const { ps } = require("../util/shell");
    const r = await ps(`shutdown /s /t ${Number(delaySeconds)}`);
    return { ok: r.code === 0, output: "Shutting down" };
  },
}];
```

```js
// src/tools/index.js — add to the modules list:
require("./shutdown"),
```

The tool (with its JSON schema) is instantly available to the LLM.

---

## Configuration

Copy `.env.example` → `.env`. Every value has a safe default.

| Variable | Default | Notes |
|---|---|---|
| `OMNIROUTE_URL` | `http://127.0.0.1:20128/v1` | OpenAI-compatible gateway |
| `OMNIROUTE_API_KEY` | *(auto: reads `~/.claude/settings.json`)* | Never logged or printed |
| `NOVA_MODEL` | `github/gpt-4o-mini` | Planner — must support function-calling |
| `NOVA_MODEL_FALLBACKS` | `github/gpt-4o-2024-11-20,ddgw/gpt-4o-mini` | Tried on error/rate-limit |
| `NOVA_MAX_STEPS` | `12` | Max tool steps per turn |
| `NOVA_CONFIRM_RISKY` | `true` | Gate medium/high-risk tools |
| `NOVA_DRY_RUN` | `false` | Preview mode: plan, never execute |
| `NOVA_API_HOST` / `NOVA_API_PORT` | `127.0.0.1` / `20129` | API bind address |

> **On free models:** `ddgw/*` is keyless and free but rate-limited and unreliable at function-calling. `github/gpt-4o-mini` (GitHub Copilot) is the dependable default.

---

## How it works

```
   CLI (nova ask/goal/chat)            Any UI (HTTP + SSE)
              │                              │
              └──────────────┬───────────────┘
                             ▼
                   ┌──────────────────┐
                   │  agent loop      │  plan → act → observe → replan
                   │  (src/core/)     │  retry · fallback · dedupe guard
                   └───────┬──────────┘
                           │ tool_calls          audit.log ◄── every call
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌────────────────┐        ┌───────────────────┐
     │ OmniRoute LLM  │        │ tool registry     │  risk gate + confirm
     │ (function call)│        │ (src/tools/*)     │
     └────────────────┘        └─────────┬─────────┘
                                         ▼
                              PowerShell 5.1 / Node
                       apps · keyboard · mouse · files · volume · agents
```

- **Planner** (`src/core/planner.js`) — OpenAI-compatible function-calling with timeouts, exponential backoff on 429/5xx, and model fallback.
- **Agent loop** (`src/core/agent.js`) — feeds tool results back, truncates context, breaks infinite duplicate-call loops, writes the audit log.
- **Goal mode** (`src/core/goal.js`) — decomposes objectives into 3–8 ordered subtasks and runs them with shared session memory.
- **Registry** (`src/tools/registry.js`) — risk gating, confirm hooks, dry-run enforcement.
- **Prompt improver** (`src/prompt/improver.js`) — optional pre-step: turns *“open that thing i was doing”* into an actionable instruction.

---

## Safety

- **Risk levels** — every tool declares `low` / `medium` / `high`. Medium and high require confirmation (CLI prompt, or SSE confirm flow in your UI).
- **Dry run** — `--dry-run` executes nothing; you see the full plan first.
- **Audit log** — every tool call and result is appended to `~/.nova/audit.log` (JSONL), queryable via `GET /audit`.
- **Loopback only** — the API listens on `127.0.0.1`; other machines cannot reach it.
- **No secrets in logs** — the gateway API key is never echoed, logged, or included in errors.

---

## Testing

```powershell
npm test            # 18 safety checks across every safe tool, no LLM calls
node scripts/test-vision.js   # probe which models accept image input
```

## Status & roadmap

**v0.2 — shipped:** 48 tools · CLI · HTTP/SSE API · goal mode · audit log · retry/fallback · environment-aware paths · prompt improver.

**Planned:**
- 🔊 Voice input: global hotkey → STT → `/ask`
- 👁️ Vision: screen Q&A + click-by-coordinates (tool code exists; waiting on a gateway that accepts image payloads)
- 🕐 Triggers & schedules ("remind me at 6")
- ⏪ Undo journal for reversible actions
- 📦 Per-app volume control

## Related

- [`ANIZXD/NOVA`](https://github.com/ANIZXD/NOVA) — the original wake-word browser extension (shares this engine's goals)
- `hey-nova` — v2.2 extension with the full command set

## License

[MIT](LICENSE) © ANIZXD
