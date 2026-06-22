# CP-1: Parser Prototype

## Work Done

Replaced the honest-zero stub in `lib/agents/opencode-telemetry.js` with a full parser that accepts `opencode export` JSON strings and returns normalized telemetry objects.

### Key changes:
- Added `extractOpencodeTelemetryFromExport(jsonString)` — parses JSON, searches for token-usage data in multiple nesting paths (`total_token_usage`, `token_usage`, `usage`, `meta`, `metadata`), and returns a normalized telemetry object.
- Added helper functions: `num()`, `findTokenUsage()`, `extractSessionId()`, `extractModelName()`, `countToolCalls()`.
- Kept `extractOpencodeTelemetry(result)` for backward compatibility — it delegates to `extractOpencodeTelemetryFromExport` when `result.exportJson` is present.
- Kept `getOpencodeProviderModel()` unchanged.
- Exported `parseOpencodeExport` as an alias for `extractOpencodeTelemetryFromExport`.

### Telemetry shape returned:
```
{
  sessionId: string|null,
  provider: 'opencode',
  model: string|null (defaults to 'qwen'),
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  totalTokens: number,
  toolCalls: number,
  usagePercent: null
}
```

### Validation rules enforced:
- Returns `null` for empty strings, non-JSON strings, and JSON objects lacking token-usage fields.
- Substitutes `0` for any missing token field.
- `totalTokens` defaults to `inputTokens + outputTokens` when not explicitly provided.
- Gracefully handles deeply nested structures and arrays.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `extractOpencodeTelemetryFromExport` returns non-null telemetry for valid export JSON with token usage | `lib/agents/opencode-telemetry.js:274` — returns object with `inputTokens=1000, outputTokens=500, cachedTokens=200, totalTokens=1500` for sample JSON |
| 2 | Returns `null` for empty string | `lib/agents/opencode-telemetry.js:247` — early return on falsy/empty input |
| 3 | Returns `null` for non-JSON string | `lib/agents/opencode-telemetry.js:252` — catches JSON parse error, returns null |
| 4 | Returns `null` for JSON without token-usage fields | `lib/agents/opencode-telemetry.js:272` — `findTokenUsage` returns null, caller returns null |
| 5 | Substitutes 0 for missing token fields | `lib/agents/opencode-telemetry.js:296` — `cachedTokens=0` when `cached_input_tokens` absent |
| 6 | Telemetry shape matches `telemetryToStatsFields` expectations | `lib/agents/opencode-telemetry.js:291-300` — shape matches: sessionId, provider, model, inputTokens, outputTokens, cachedTokens, totalTokens, toolCalls, usagePercent |

## Next action
Wire the parser into `lib/agents/opencode.js` `startOpencodeAgent` to call `opencode export` after session completion and attach telemetry to `result.telemetry`.
