# CP-2: Field Mapping Requirements

## Summary

Analyzed the field mapping between `extractMistralTelemetry` output (`lib/agents/mistral-telemetry.ts:29-40`) and `telemetryToStatsFields` input expectations (`lib/commands/stats.ts:1692-1710`).

### Source shape (TelemetryResult from mistral-telemetry.ts)
```
inputTokens, outputTokens, totalTokens, contextTokens,
toolCallsAgreed, toolCallsRejected, toolCallsFailed, toolCallsSucceeded,
sessionCost, path?
```

### Target shape (expected by telemetryToStatsFields)
```
provider, model, inputTokens, outputTokens, cachedTokens, totalTokens,
toolCalls, usagePercent, cost_usd
```

### Mapping decisions
| Source field | Target field | Strategy |
|-------------|-------------|----------|
| `contextTokens` | `cachedTokens` | Direct rename — meta.json `context_tokens` = cached/prompt tokens |
| `toolCallsAgreed + toolCallsRejected + toolCallsFailed + toolCallsSucceeded` | `toolCalls` | Sum all four counters |
| `sessionCost` | `cost_usd` | Direct rename |
| (absent) | `usagePercent` | Set to `null` — mistral meta.json has no usage % field |
| `getMistralProviderModel()` | `provider` | Hardcoded `{provider:'mistral', model:'mistral'}` |
| `getMistralProviderModel()` | `model` | Fallback to `'mistral'` |

No changes to `telemetryToStatsFields` core logic needed — only field mapping in the caller.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| `contextTokens` → `cachedTokens` mapping decided | CP-2 summary table, row 2 | Decided |
| Tool calls aggregation strategy decided | CP-2 summary table, row 3: sum all four | Decided |
| `sessionCost` → `cost_usd` mapping decided | CP-2 summary table, row 4 | Decided |
| `usagePercent` default decided | CP-2 summary table, row 5: null | Decided |
| Field mapping fits within restricted areas | No changes to stats.ts telemetryToStatsFields | Confirmed |

## Next action

Proceed to CP-3: implement `processResult` in `lib/agents/mistral.ts` with the decided field mapping and wire it into `startMistralAgent`.
