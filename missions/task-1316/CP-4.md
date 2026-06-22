# CP-4: End-to-End Verification

## Work Done

Verified that `extractOpencodeTelemetryFromExport` correctly parses real `opencode export` JSON from opencode v2.0.0 and produces non-zero telemetry values.

### E2E test with real opencode session

The real export is committed as the durable fixture
`test/fixtures/opencode-export-v2.json` (session `ses_132f470d8ffexge85esdX0nzCs`,
~565KB). Parsing it through `extractOpencodeTelemetryFromExport` yields:

```
sessionId: ses_132f470d8ffexge85esdX0nzCs
provider: opencode
model: cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit
inputTokens: 2802261
outputTokens: 23469
cachedTokens: 0
totalTokens: 2825730 (= inputTokens + outputTokens)
toolCalls: 59
usagePercent: null
```

All validations passed (asserted by
`test/opencode-telemetry.test.js` → "parses the real opencode v2 export fixture"):
- Non-zero `input_tokens` (2,802,261) ✓
- Non-zero `output_tokens` (23,469) ✓
- `provider === 'opencode'` ✓
- `totalTokens = inputTokens + outputTokens` ✓
- `toolCalls === 59` (counted from `messages[].parts[]`) ✓
- Session ID correctly extracted from `info.id` ✓
- Model correctly extracted from `info.model.id` ✓

### Integration fix: bounded full-capture for export (round 1 review)

The first pass used `spawnAndTee` with `maxTailBytes: 1MB`. Review finding #2 showed that a
tail buffer discards the document *prefix* once output exceeds the cap, so exports larger than
1 MiB lose their leading `{` and `JSON.parse` returns null. Replaced this with a dedicated
`captureOpencodeExport` helper (`lib/agents/opencode-export.js`) that:

- Captures the **complete** export into memory up to an explicit 32 MiB cap, and fails
  *explicitly* (returns null) when exceeded — no silent truncation into garbage JSON.
- Enforces a 30 s timeout that kills a hung/non-exiting `opencode export` child, so the
  launcher can never block (review finding #1, mission risk + stop rule).

Durable tests: `test/opencode-export.test.js` (timeout kills child, oversize fails explicitly,
spawn-throws/error degrade to null).

### Tool-call counting fix (review finding #3)

Real `opencode export` stores tool calls in `messages[].parts[]` where `part.type === 'tool'`.
`countToolCalls` now traverses that schema. The real fixture reports `toolCalls: 59`
(previously 0). Covered by `test/opencode-telemetry.test.js`.

### Durable end-to-end evidence (review finding #4)

Criterion 6 is now exercised by `test/opencode-launcher-telemetry.test.js`:
- `startOpencodeAgent attaches telemetry from the captured export` — launcher export attachment.
- `startOpencodeAgent does not hang when the real export capture times out` — non-exiting
  export proven non-blocking at the launcher level.
- `startOpencodeAgent telemetry flows through to a non-zero stats CSV row` — drives
  `telemetryToStatsFields` + `upsertStatsRow` and asserts non-zero `input_tokens`/`output_tokens`
  and `tool_calls=59` in the written CSV.

The real export is committed as a durable fixture at `test/fixtures/opencode-export-v2.json`
(no longer relying on `/tmp`).

### Parser schema discovery

The actual opencode v2.0.0 export JSON has the token structure at:
```json
{
  "info": {
    "tokens": {
      "input": 2802261,
      "output": 23469,
      "cache": { "read": 0, "write": 0 }
    },
    "model": { "id": "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit" }
  }
}
```

Updated `findTokenUsage` to handle `info.tokens` path with `input`/`output`/`cache.read` field names, and updated `extractSessionId` and `extractModelName` to handle `info.id` and `info.model.id` respectively.

### Regression verification

Full `npm test` suite: 1533 pass, 0 fail, 0 cancelled, 22 skipped (pre-existing).
Reviewer's focused command
`node --test test/opencode-export.test.js test/opencode-launcher-telemetry.test.js
test/opencode-telemetry.test.js test/telemetry-stubs.test.js`: 42 pass, 0 fail,
0 cancelled (timeout test made deterministic — see round-2 fix below).

### Round-2 fix: deterministic export timeout

The round-1 timeout used `timer.unref()`, which let Node's test runner skip the
timer when the loop was otherwise idle, cancelling the timeout tests. Removed the
`unref()` (`lib/agents/opencode-export.js`): the caller always awaits the Promise
and `finish()` clears the timer, so a ref'd timer is correct and deterministic.
Verified stable across repeated runs.

## Goal Check

| # | Mission success criterion | Evidence (file → test) |
|---|---------------------------|------------------------|
| 1 | `npm test` passes incl. new + updated tests | `npm test`: 1533 pass, 0 fail, 0 cancelled, 22 skipped |
| 2 | `extractOpencodeTelemetryFromExport` returns non-null with `total = in+out`, provider `opencode` | `test/opencode-telemetry.test.js` → "parses the real opencode v2 export fixture" (`in=2802261`, `out=23469`, `total=2825730`) |
| 3 | Returns `null` for empty / non-JSON / token-less JSON | `test/opencode-telemetry.test.js` → "returns null for empty string", "rejects malformed JSON", "returns null for JSON without token fields" |
| 4 | Missing token field → `0`, no throw/null | `test/opencode-telemetry.test.js` → "substitutes 0 for missing cached_tokens" |
| 5 | `startOpencodeAgent` attaches non-null `result.telemetry` | `test/opencode-launcher-telemetry.test.js` → "attaches telemetry from the captured export" |
| 6 | Controlled run writes non-zero `input_tokens`/`output_tokens` to stats CSV | `test/opencode-launcher-telemetry.test.js` → "telemetry flows through to a non-zero stats CSV row" (asserts CSV `input_tokens>0`, `output_tokens>0`, `tool_calls=59`) |
| 7 | No regressions (codex/claude/stats/draft/review-loop/stage-telemetry) | `npm test`: 0 fail, 0 cancelled |
| — | Tool calls counted from real `messages[].parts[]` schema | `test/opencode-telemetry.test.js` → "counts tool calls in messages[].parts[]" + real-fixture `toolCalls=59` |
| — | Export cannot hang the launcher (timeout kills child) | `test/opencode-export.test.js` → "times out and kills a non-exiting export child"; `test/opencode-launcher-telemetry.test.js` → "does not hang when the real export capture times out" |
| — | Exports over cap fail explicitly, no silent truncation | `test/opencode-export.test.js` → "fails explicitly when output exceeds maxBytes" |

All evidence above cites durable, committed tests (no `/tmp`, no removed code).

## Next action
Hand off for re-review. Mission gate `./scripts/verify-local.sh docs` is unrunnable
(script absent on this branch and `main`); `workflow.config.json` configures
`npm test` as the verification command, which passes.
