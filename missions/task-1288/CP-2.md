# CP-2: Implement extractMistralTelemetry() with fixture-backed test

## Work Done

Implemented `extractMistralTelemetry()` in `lib/agents/mistral-telemetry.ts` following the codex-telemetry pattern:

### Module structure
- **`parseMistralMeta(meta)`** — Parses the `stats` block from a meta.json into a telemetry object with fields: `inputTokens`, `outputTokens`, `totalTokens`, `contextTokens`, `toolCallsAgreed`, `toolCallsRejected`, `toolCallsFailed`, `toolCallsSucceeded`, `sessionCost`. Returns null for missing stats, garbage input, or all-zero stats (no usable signal).
- **`extractMistralTelemetry(result, basePath?)`** — Scans `~/.vibe/logs/session/` for the most recent session meta.json, parses it, and returns the telemetry object. Accepts optional `basePath` for test isolation. Legacy `result` parameter preserved for API compatibility.
- **`getMistralProviderModel()`** — Unchanged; returns `{ provider: 'mistral', model: 'mistral' }`.

### Exported members
- `parseMistralMeta` — parse function (mirrors `parseCodexRollout`)
- `extractMistralTelemetry` — extract function (mirrors `extractCodexTelemetry`)
- `getMistralProviderModel` — fallback identity
- `DEFAULT_MISTRAL_LOG_DIR` — configurable default path

### Test coverage in `test/telemetry-stubs.test.js`
Replaced the old null-returning tests with a temp-directory-isolated test block and added 12 fixture-backed tests:
- 5 tests for `parseMistralMeta` (valid data, missing stats, garbage input, all-zero stats, string coercion)
- 7 tests for `extractMistralTelemetry` (empty dir, no sessions, newest session parse, skip-no-meta, skip-corrupt, skip-zero-stats, fallback-to-older)
- 1 test for `getMistralProviderModel` (unchanged)

### Field mapping (meta.json → telemetry)
| meta.json field | telemetry field |
|---|---|
| `stats.session_prompt_tokens` | `inputTokens` |
| `stats.session_completion_tokens` | `outputTokens` |
| `stats.session_total_llm_tokens` | `totalTokens` |
| `stats.context_tokens` | `contextTokens` |
| `stats.tool_calls_agreed` | `toolCallsAgreed` |
| `stats.tool_calls_rejected` | `toolCallsRejected` |
| `stats.tool_calls_failed` | `toolCallsFailed` |
| `stats.tool_calls_succeeded` | `toolCallsSucceeded` |
| `stats.session_cost` | `sessionCost` |

## Goal Check

| Criterion | Evidence |
|---|---|
| `extractMistralTelemetry()` returns non-null telemetry with `inputTokens`, `outputTokens`, `totalTokens` | `test/telemetry-stubs.test.js:78-89` — "extracts telemetry from meta.json stats" asserts `inputTokens: 9331`, `outputTokens: 62`, `totalTokens: 9393` |
| Fixture-backed test mirrors codex-telemetry pattern | `test/telemetry-stubs.test.js:18-44` — `SAMPLE_META` fixture based on real session `session_20260701_171711_fbdc221c/meta.json` |
| Defensive parsing with null-fallback | `test/telemetry-stubs.test.js:91-106` — tests for missing stats, garbage input, corrupt meta.json, all-zero stats |
| Newest session selected | `test/telemetry-stubs.test.js:122-150` — "parses the most recent session meta.json" verifies `path` points to the newer session |
| Falls back to older valid session | `test/telemetry-stubs.test.js:176-195` — "picks valid session when newer one has zero stats" |
| No changes to restricted areas | Only `lib/agents/mistral-telemetry.ts` and `test/telemetry-stubs.test.js` modified |

## Next action

Run `npm test` and `./scripts/verify-local.sh static-analysis` to confirm all tests pass and static analysis is clean (CP-3).
