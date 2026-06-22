# CP-3: Tests

## Work Done

Created `test/opencode-telemetry.test.js` with 21 offline unit tests and updated `test/telemetry-stubs.test.js` assertions.

### New test file: `test/opencode-telemetry.test.js` (21 tests)
- **Parsing valid export JSON** (6 tests): covers `total_token_usage`, flat fields, `token_usage`, `usage`, `meta`, `metadata` nesting paths
- **Invalid inputs** (4 tests): empty string, non-JSON, JSON without token fields, JSON array without tokens
- **Graceful zero fallback** (2 tests): missing `cached_input_tokens` defaults to 0, `totalTokens` derived from `inputTokens + outputTokens`
- **Default model** (1 test): defaults to `'qwen'` when model absent from JSON
- **Telemetry shape validation** (1 test): verifies all fields match `telemetryToStatsFields` expectations, confirms `totalTokens = inputTokens + outputTokens`
- **Non-object JSON rejection** (1 test): strings, numbers, booleans, arrays all return null
- **All-zeros rejection** (1 test): returns null when all token fields are 0
- **Backward compat** (4 tests): `extractOpencodeTelemetry` returns null for undefined/null/empty, parses `exportJson`, passes through `telemetry`, prefers `exportJson` over `telemetry`
- **Provider model** (1 test): `getOpencodeProviderModel` returns `{provider: 'opencode', model: 'qwen'}`

### Updated stub tests: `test/telemetry-stubs.test.js`
- Changed `'extractOpencodeTelemetry returns null even with telemetry field present'` to `'extractOpencodeTelemetry passes through result.telemetry when present'` — reflects new parser behavior where pre-existing telemetry is passed through.

### Regression verification
- Full `npm test` suite: 1518 pass, 0 fail, 22 skipped (pre-existing)
- No regressions in codex-telemetry, claude-telemetry, stats, agents, draft, review-loop, or stage-telemetry tests

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `npm test` passes with zero failures | `npm test` output: `pass 1518, fail 0` |
| 2 | New `test/opencode-telemetry.test.js` tests pass | `node --test test/opencode-telemetry.test.js`: `pass 21, fail 0` |
| 3 | Updated `test/telemetry-stubs.test.js` assertions pass | `node --test test/telemetry-stubs.test.js`: `pass 6, fail 0` |
| 4 | Parsing valid export JSON produces correct shape | `test/opencode-telemetry.test.js:12-25` — validates sessionId, provider, model, inputTokens, outputTokens, cachedTokens, totalTokens, toolCalls, usagePercent |
| 5 | Missing token fields substitute 0 | `test/opencode-telemetry.test.js:109-117` — asserts `cachedTokens === 0` when `cached_input_tokens` absent |
| 6 | Malformed/non-token JSON returns null | `test/opencode-telemetry.test.js:63-66` — asserts null for empty, non-JSON, no-token JSON |
| 7 | No regression in existing tests | `npm test`: 0 failures across all telemetry, stats, agents, draft, review-loop tests |

## Next action
CP-4: End-to-end verification — confirm that a controlled draft run with an opencode agent producing token data writes non-zero `input_tokens` and `output_tokens` to the stats CSV.
