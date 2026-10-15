# Contributing to Nova Helper

Thanks for helping make Nova better.

## Ground rules

1. **Safety first.** Any new tool must declare an honest `risk` level. If it can
   lose data, close work, or touch the system — it's `medium` or `high`, and it
   must stay behind the confirm gate.
2. **No dependencies without discussion.** The project is deliberately zero-dep
   (Node + PowerShell 5.1 only). Open an issue before adding one.
3. **Verify before claiming.** Run `npm test` (18 tool checks) plus any real
   scenario you changed, and paste the output in your PR.

## Adding a tool

1. Create `src/tools/<name>.js` exporting an array (or `{ tools: [...] }`):

   ```js
   module.exports = [{
     name: "my_tool",                    // snake_case, unique
     description: "What it does + when to use it (the LLM reads this).",
     risk: "low" | "medium" | "high",
     parameters: { type: "object", properties: { /* JSON Schema */ } },
     async execute(args, ctx) {
       return { ok: true, output: "human-readable summary", data: {} };
     },
   }];
   ```

2. Register it in `src/tools/index.js` (add to the `modules` list).
3. Add a check to `scripts/smoke.js` if it's safe/non-destructive.
4. Run `npm test` and `nova tools` to confirm it shows up.

### Tool guidelines

- `output` is what the LLM sees — keep it short and factual (truncate big payloads yourself if needed).
- Return `{ ok: false, output: "why it failed" }` instead of throwing when possible.
- Prefer narrow tools over `run_command`. `run_command` is the last resort.
- For Windows calls, use `src/util/shell.js` (`ps`, `run`, `spawnDetached`).
  PowerShell scripts get `$ErrorActionPreference='Stop'` automatically so failures
  surface as non-zero exit codes instead of silently "succeeding".

## Dev workflow

```powershell
npm test                      # tool smoke tests (no LLM)
node src/index.js doctor      # environment check
node src/index.js ask --dry-run "a task"    # plan-only, executes nothing
node src/index.js ask --yes "a real task"   # full run (confirm-gated without --yes)
```

## Commits

Use clear, imperative messages: `feat: add per-app volume tool`,
`fix: screenshot verification`, `docs: document confirm flow`.
