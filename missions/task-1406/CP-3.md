# CP-3: Wire Telemetry Extraction in mistral.ts

## Summary

Implemented `processResult` function in `lib/agents/mistral.ts` that:
1. Calls `extractMistralTelemetry` from `./mistral-telemetry.js` with optional `basePath` override
2. Maps telemetry fields to the shape expected by `telemetryToStatsFields`:
   - `contextTokens` → `cachedTokens`
   - Aggregates all 4 tool call counters → `toolCalls`
   - `sessionCost` → `cost_usd`
   - Sets `usagePercent: null` (no usage % in mistral meta.json)
   - Sets `provider: 'mistral'` and `model` from meta.json or fallback
3. Updates `startMistralAgent` to call `processResult` on the spawn result
4. Updated the comment on line 25-29 to reflect actual telemetry capability
5. Added `ProcessedResult` interface with proper typing
6. Exported `processResult` and `getMistralProviderModel` for testability

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| `processResult` calls `extractMistralTelemetry` | `lib/agents/mistral.ts:54` | Implemented |
| Field mapping: `contextTokens` → `cachedTokens` | `lib/agents/mistral.ts:74` | Implemented |
| Field mapping: tool call aggregation | `lib/agents/mistral.ts:60-64` | Implemented |
| Field mapping: `sessionCost` → `cost_usd` | `lib/agents/mistral.ts:78` | Implemented |
| `usagePercent: null` set | `lib/agents/mistral.ts:77` | Implemented |
| `provider` and `model` set | `lib/agents/mistral.ts:69-70` | Implemented |
| Comment on line 25 updated | `lib/agents/mistral.ts:26-29` | Updated |
| `startMistralAgent` uses `processResult` | `lib/agents/mistral.ts:134` | Wired |
| Existing tests still pass (27/27) | `test/telemetry-stubs.test.js` + `test/mistral.test.js` | Verified |
| No changes to `telemetryToStatsFields` | Restricted area preserved | Confirmed |

## Next action

Proceed to CP-4 (local test with real data) and CP-5 (unit tests for processResult).
