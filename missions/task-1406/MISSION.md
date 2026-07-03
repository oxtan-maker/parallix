# Mission: Fix mistral stats to capture all telemetry metrics beyond duration (task-1406)

## Goal
Wire up Mistral/Vibe telemetry extraction in the mistral agent launcher so that `px stats` reports input tokens, output tokens, cached tokens, tool calls, usage percentage, and cost for mistral sessions — not just duration.

## Why Now
Currently `px stats task-1403` shows mistral phase rows with dashes (`—`) for Usage %, Cost ($), and zero values for input/output/cached tokens, while other providers (opencode, anthropic, codex) show real values. The telemetry infrastructure already exists (`lib/agents/mistral-telemetry.ts`) to parse `~/.vibe/logs/session/<session_id>/meta.json`, but the mistral agent launcher (`lib/agents/mistral.ts`) never calls it, so `result.telemetry` is always `undefined`. This makes mistral appear to have zero resource consumption, distorting cost tracking and model comparison in the stats dashboard.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Data integrity for stats dashboard, accurate cost tracking, parity with other providers

## Scope
- Add a `processResult` function in `lib/agents/mistral.ts` that calls `extractMistralTelemetry` and attaches the result to `result.telemetry`
- Update `lib/agents/mistral.ts` to import and use `extractMistralTelemetry` from `./mistral-telemetry.ts`
- Map mistral telemetry fields to the expected telemetry shape consumed by `telemetryToStatsFields` in `lib/commands/stats.ts`:
  - `sessionCost` → `cost_usd`
  - `contextTokens` → `cachedTokens`
  - Aggregate `toolCallsAgreed`, `toolCallsRejected`, `toolCallsFailed`, `toolCallsSucceeded` → `toolCalls`
  - Add `usagePercent: null` (Mistral meta.json does not expose usage percentage)
  - Add `provider: 'mistral'` and `model` from meta.json stats block or fallback to 'mistral'
- Remove or update the outdated comment on line 25 of `lib/agents/mistral.ts` that claims "mistral/vibe does not expose token-usage data"
- Add corresponding tests for the new mistral telemetry wiring

## Out of Scope
- Changes to `px stats` CLI output formatting
- Changes to CSV schema or column order
- Modifying how other agents (claude, codex, opencode) extract telemetry
- Changes to `px stats-backfill` command
- Adding new CLI flags
- Changing the mistral-telemetry.ts parsing logic for meta.json

## Success Criteria
- `px stats task-1403` (or any mission with mistral execute phase) shows non-zero, non-dash values for input_tokens, output_tokens, cached_tokens, tool_calls, cost_usd, and openai_usage_after in the mistral phase row
- The mistral agent launcher populates `result.telemetry` with an object matching the shape expected by `telemetryToStatsFields` in `lib/commands/stats.ts:1692-1710`
- `result.telemetry` contains: `provider`, `model`, `inputTokens`, `outputTokens`, `cachedTokens`, `totalTokens`, `toolCalls`, `usagePercent`, `cost_usd`
- Existing tests in `test/telemetry-stubs.test.js` for `parseMistralMeta` and `extractMistralTelemetry` continue to pass
- `node --test test/telemetry-stubs.test.js` reports all tests passing
- `px stats --mission <any-mission-with-mistral>` no longer shows `—` or `0` for mistral token metrics when real usage exists in meta.json

## Risks and Assumptions
- **Risk:** Mistral/Vibe meta.json format may change in future versions, breaking `parseMistralMeta`. Mitigation: telemetry extraction is best-effort and errors are caught and logged without breaking the launch.
- **Risk:** Field name mismatch between mistral-telemetry (`contextTokens`, `sessionCost`) and stats expectations (`cachedTokens`, `cost_usd`) may require adapter logic. Mitigation: add field mapping in the mistral agent's `processResult` before attaching to `result.telemetry`.
- **Assumption:** Mistral/Vibe always writes meta.json to `~/.vibe/logs/session/<session_id>/meta.json` with the documented `stats` block structure. This is validated by existing `extractMistralTelemetry` implementation in task-1288.
- **Assumption:** The `totalTokens` field from mistral-telemetry should map to `context_tokens` in stats (current behavior on line 1702 of stats.ts), but this may be semantically incorrect. Verify correct mapping during implementation.

## Checkpoints
- CP 1: Verify current behavior — confirm `px stats task-1403` shows `—` for Usage % and Cost ($) and `0` for input/output/cached tokens on mistral rows by inspecting actual stats CSV
- CP 2: Identify exact field mapping requirements — determine how `contextTokens` and `sessionCost` from mistral-telemetry should map to `cachedTokens` and `cost_usd` expected by `telemetryToStatsFields`; decide on toolCalls aggregation strategy
- CP 3: Wire telemetry extraction in mistral.ts — add `processResult` function that calls `extractMistralTelemetry`, maps fields, and attaches `result.telemetry`; update startMistralAgent to use it
- CP 4: Test the fix locally — run a test mission with mistral, then verify `px stats <mission>` shows real token and cost values for the mistral phase
- CP 5: Add unit tests — add tests for the new `processResult` wiring that verify `result.telemetry` is populated with correct field names and values

## Gates
- [x] ./scripts/verify-local.sh docs
- [x] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `lib/commands/stats.ts` `telemetryToStatsFields` function signature or core logic (only field mapping if necessary for compatibility)
- Do not modify CSV schema in `lib/commands/stats.ts` (STATS_HEADERS)
- Do not modify other agent telemetry modules (claude-telemetry.ts, codex-telemetry.ts, opencode-telemetry.ts)
- Do not modify mistral-telemetry.ts parsing logic (parseMistralMeta, extractMistralTelemetry)

## Stop Rules
- Stop if any existing telemetry test fails after the change: `node --test test/telemetry-stubs.test.js` must pass
- Stop if `px stats` output breaks for non-mistral missions
- Stop if the fix requires changing the CSV schema (STATS_HEADERS) — escalate for architecture review
- Stop if field mapping cannot be resolved without modifying `telemetryToStatsFields` core logic
