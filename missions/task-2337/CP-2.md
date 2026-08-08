# CP-2: Fix model propagation in the recording path

## Summary

Fixed the root cause of custom agents displaying `"custom"` instead of their actual model name in the stats "Agent performance" table.

**Bug chain traced:**
1. `extractTelemetryFromStats(stats)` in `src/adapters/agents/pi.ts:171` returned `model: undefined` because `SessionStats` from the SDK has no model field
2. `resolveAgentModel('custom', worktree)` returned `null` because `adapters.agents.models.custom` is not configured in `workflow.config.json`
3. `telemetryToStatsFields` in `src/adapters/cli/commands/stats.ts:1856` fell back to `agentFamily` = `'custom'`

**Fix applied:**
- Modified `extractTelemetryFromStats` in `src/adapters/agents/pi.ts` to accept an optional `model` parameter (`model?: string`) and pass it through to the telemetry object
- Updated both call sites (success path at line 397, error path at line 430) to extract `session.model?.id` from the SDK session and pass it to `extractTelemetryFromStats`
- Updated `result.model` from hardcoded `undefined` to `session.model?.id || undefined`

**Recording path verified (no code changes needed):**
- `recordStageStatsSafe` in `src/adapters/review/review-loop.ts:134` passes `model` to `accumulateStageStats`
- `accumulateStageStats` in `src/adapters/cli/commands/stats.ts:1976` passes `model` to `telemetryToStatsFields`
- `telemetryToStatsFields` in `src/adapters/cli/commands/stats.ts:1856` uses `model: (t && t.model) || model || agentFamily || ''`
- `resolveAgentModel` in `src/adapters/config/product-config.ts:482` reads `adapters.agents.models[agentFamily]`

All 1713 tests pass, including the 5 task-2337 reproduction tests and 2 new Pi launcher model propagation tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| extractTelemetryFromStats accepts model parameter | `src/adapters/agents/pi.ts:171`, function signature `extractTelemetryFromStats(stats: any, model?: string)` | PASS |
| extractTelemetryFromStats uses model parameter | `src/adapters/agents/pi.ts:175`, `model,` in return object | PASS |
| Success path passes session.model.id | `src/adapters/agents/pi.ts:397`, `extractTelemetryFromStats(stats, session.model?.id)` | PASS |
| Error path passes session.model.id | `src/adapters/agents/pi.ts:430`, `extractTelemetryFromStats(stats, session?.model?.id)` | PASS |
| result.model populated from session | `src/adapters/agents/pi.ts:404`, `model: session.model?.id \|\| undefined` | PASS |
| recordStageStatsSafe passes model to accumulateStageStats | `src/adapters/review/review-loop.ts:134`, `getStats().accumulateStageStats({ ..., model })` | PASS |
| accumulateStageStats passes model to telemetryToStatsFields | `src/adapters/cli/commands/stats.ts:1976`, `telemetryToStatsFields(telemetry, { ..., model: model \|\| undefined })` | PASS |
| telemetryToStatsFields model fallback chain | `src/adapters/cli/commands/stats.ts:1856`, `model: (t && t.model) \|\| model \|\| agentFamily \|\| ''` | PASS |
| resolveAgentModel reads config for custom family | `src/adapters/config/product-config.ts:482`, `models[agentFamily]` | PASS |
| Reproduction tests pass | `test/task-2337-repro.test.ts`, 5 tests pass | PASS |
| Pi runner tests pass | `test/pi-runner.test.ts`, 20 tests pass (18 existing + 2 task-2337 model propagation) | PASS |
| Full test suite passes | `./scripts/verify-local.sh all`, 1713 tests pass, 0 fail | PASS |
| Pi launcher model result test | `test/pi-runner.test.ts`, `"startPiAgent result includes session.model.id in result.model and result.telemetry.model (task-2337)"` | PASS |
| Pi launcher model absent test | `test/pi-runner.test.ts`, `"startPiAgent result.model is undefined when session.model is absent (task-2337)"` | PASS |
| Falsifiability rule | `ADR 0048` | PASS |

## Next action

CP-3: Add targeted unit tests for `telemetryToStatsFields` model fallback chain and `resolveAgentModel` for the `custom` family. Verify all existing tests in `test/stats.test.ts`, `test/opencode-telemetry.test.ts`, and `test/product-config.test.ts` pass.
