# CP-1 (Red): Reproduction

## Summary

Reproduced the reported symptom — `mistral`/`vibe` gets re-blocklisted after the
usage block was lifted — with a hermetic test that does not require a live
`vibe` binary. The other three launcher families (`claude`, `custom`/opencode,
`codex`) each pass an explicit non-interactive bypass so the CLI never blocks on
an interactive tool-approval prompt:

- `lib/agents/claude.ts:74` — `const args = ['--dangerously-skip-permissions'];`
- `lib/agents/opencode.ts:142` — `const args = ['run', '--pure', '--dangerously-skip-permissions'];`
- `lib/agents/codex.ts:188,192` — writes `trust_level = "trusted"` into the generated config.

`lib/agents/mistral.ts:44` only passes `['--prompt', prompt, '--trust', '--output', 'text']`.
Per the real `vibe --help` output, `--trust` only "Trust[s] the working directory
for this invocation" — it does **not** bypass per-tool approval prompts. Real
`vibe` documents a separate `--auto-approve`/`--yolo` flag for that ("Approves
all tool calls without prompting"), which `buildMistralInvocation` never passes.

In a non-interactive workflow run (no TTY on stdin), any `vibe` invocation whose
prompt needs a tool call fails with a generic, non-limit error. That failure
text does not match any pattern in `PATTERN_SETS.mistral` (`lib/agents/limit-hit.ts:29-39`)
or `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` (`lib/agents/agents.ts:113-123`), so
`shouldPersistLaunchFailureBlock` (`lib/agents/agents.ts:171-181`) falls through
to its default `true` and a fresh persistent blocklist entry is written on
every single launch — reproducing "unblocked, but ends up in blocklist all the
time."

## Reproduction

`test/agents.test.js:1939` — `mistral without a non-interactive tool-approval
bypass gets re-blocklisted on every launch`

The test installs a fake `vibe` launcher on `PATH` that exits non-zero with a
generic "Tool call requires approval but no interactive terminal is available."
message unless `--yolo`/`--auto-approve` is present in argv, then drives
`startAgent('active', ...)` with only `mistral` eligible.

Confirmed RED on the pre-fix tree:

```
✖ mistral without a non-interactive tool-approval bypass gets re-blocklisted on every launch (50.037343ms)
  Error: All eligible agents exhausted for step "active". Tried: mistral. Errors: mistral: exit 1 (Tool call requires approval but no interactive terminal is available.).
      at startAgent (/home/magnus/code/parallix-task-1398/lib/agents/agents.js:638:23)
```

`blockCalls` in the test captured exactly one `updateAgentBlockFn` invocation
for `agent: 'mistral'`, i.e. a persistent blocklist write, before the test's
assertion even runs (the test throws first since only `mistral` was eligible —
this is the falsifying reproduction required by CP-1).

## Goal Check

| Criterion | Evidence |
|---|---|
| Reproduction exists and fails pre-fix | `test/agents.test.js:1939` fails with `All eligible agents exhausted ... mistral: exit 1 (Tool call requires approval ...)` — full run above |
| Reproduction is hermetic (no live launcher) | Fake `vibe` script installed via `withPathLaunchers` (`test/agents.test.js:51`), no network/API access |
| Root-cause surface identified | `lib/agents/mistral.ts:44` (`buildMistralInvocation`) vs. `lib/agents/claude.ts:74`, `lib/agents/opencode.ts:142` |

Next action: CP-2 — confirm this is the actual decision point that turns the failure into a persistent write (trace `shouldPersistLaunchFailureBlock`/`updateAgentBlockFn` call site) and explicitly rule out the prior non-limit launch-failure theory (`isHardOpencodeFailure` import gap) as the cause.
