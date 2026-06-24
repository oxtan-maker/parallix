# CP-1: Inspect the qwen telemetry flow and identify where data is dropped

## Summary

Traced the full qwen/opencode telemetry path and reproduced the failure against
the real `opencode` binary (v2.0.0) installed at `~/.opencode/bin/opencode`.

The pipeline is:

1. `startOpencodeAgent` runs `opencode run ...` and reads `result.stdout`
   (`lib/agents/opencode.js:168-169`).
2. `extractOpencodeSessionId(stdout)` pulls the session id with
   `OPENCODE_SESSION_ID_RE = /opencode\s+-s\s+(ses_\S+)/i`
   (`lib/agents/opencode.js:22-28`).
3. Only when a session id is found does it call `opencode export <id>`
   (`lib/agents/opencode.js:171-187`) and parse it with
   `extractOpencodeTelemetryFromExport` (`lib/agents/opencode-telemetry.js:261`).
4. The telemetry is attached to `result.telemetry`, carried through `agents.js`,
   and recorded by `recordStageStats` →
   `telemetryToStatsFields` (`lib/commands/stats.js:1301`).

## Root cause (concrete + reproducible)

The session-id regex matches a footer line — `Continue  opencode -s ses_<id>` —
that opencode **no longer prints** in non-interactive `opencode run` mode
(v2.0.0). The launcher invokes opencode with
`['run', '--pure', '--dangerously-skip-permissions', ...]`
(`lib/agents/opencode.js:35`), whose stdout is only the assistant text.

Reproduced directly:

```
$ cd /tmp && opencode run --pure --dangerously-skip-permissions 'say hi in one word'
The user wants me to say hi in one word. Simple request.
</think>
Hi
$ grep -i 'ses_\|opencode -s' <stdout/stderr>   # -> no match (exit 1)
```

Because no `ses_` token appears anywhere on stdout/stderr,
`extractOpencodeSessionId` returns `null`, the `opencode export` step is skipped,
`result.telemetry` stays unset, and `telemetryToStatsFields(null, ...)` writes
honest zeros with provider/model falling back to the family name. This is exactly
what `<PARALLIX_HOME>/stats.csv` shows: **all 140 qwen rows have
`input_tokens=output_tokens=cached_tokens=tool_calls=0`**.

The downstream pieces are NOT broken:
- `opencode export <session>` works and emits `info.tokens`
  (`{input:11090,output:22,...}`) for a freshly-created session.
- `extractOpencodeTelemetryFromExport` already understands the
  `info.tokens` v2.x shape (`lib/agents/opencode-telemetry.js:102-112`) and its
  unit tests pass.

So the single broken link is **session-id recovery from stdout**.

## Fix direction (for CP-2/CP-3)

Add `--format json` to the `opencode run` invocation. In JSON mode opencode
streams NDJSON events that each carry `"sessionID":"ses_..."`, e.g.:

```
{"type":"step_start",...,"sessionID":"ses_10acbf09fffeimKc7ouh0Kjh2d",...}
```

Broaden `extractOpencodeSessionId` to also match a JSON `sessionID` field while
keeping the legacy footer regex as a fallback (preserves existing tests and any
opencode build that still prints the footer). The export+parse pipeline is then
reached unchanged.

## Goal Check

| Mission goal (CP1) | Evidence |
| --- | --- |
| Trace telemetry path across the named modules | `lib/agents/opencode.js:168-187`, `lib/agents/opencode-telemetry.js:261`, `lib/agents/stage-telemetry.js:27`, `lib/commands/stats.js:1301-1318` |
| Identify the concrete failure mode | Session id not captured: `OPENCODE_SESSION_ID_RE` at `lib/agents/opencode.js:22` does not match opencode v2.0.0 `run` stdout |
| Reproducible failing condition | `opencode run --pure ...` emits no `ses_` token; `grep` exits 1 (shown above); 140/140 qwen rows zero in `~/.local/state/parallix/stats.csv` |
| Downstream parser proven healthy | `opencode export ses_10acbf09...` → `info.tokens {input:11090,output:22}`; parsed by `lib/agents/opencode-telemetry.js:102-112` |

Next action: Add a regression test that drives `startOpencodeAgent` with opencode
v2.0.0 JSON-style stdout (a `"sessionID":"ses_..."` line, no footer) and asserts
telemetry is attached — failing before the fix, passing after (CP-2).
