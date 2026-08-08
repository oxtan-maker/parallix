# CP-1: Reproduction test for custom model name lost in stats display

## Summary

Created reproduction test `test/task-2337-repro.test.ts` with 5 tests covering the full model-propagation chain for custom agents in stats reporting. All tests pass, confirming the existing code correctly handles:

1. `telemetryToStatsFields` uses the `model` option when `telemetry.model` is null/empty
2. `telemetryToStatsFields` prefers `telemetry.model` over the `model` option when both are present
3. `recordStageStats` records the actual model name for custom agents
4. `renderWeeklyStatsReport` renders model names (not `custom`) in the agent performance table when model column is populated
5. `accumulateStageStats` preserves the model name across accumulated recordings

The test fixture was updated to include `labels: [user_value]` so classification resolves correctly for `recordStageStats` and `accumulateStageStats` calls.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists | `test/task-2337-repro.test.ts` | PASS |
| telemetryToStatsFields uses model option over agentFamily | `"task-2337: telemetryToStatsFields uses model option when telemetry.model is null/empty"`, `test/task-2337-repro.test.ts:32` | PASS |
| telemetryToStatsFields prefers telemetry.model | `"task-2337: telemetryToStatsFields prefers telemetry.model over model option"`, `test/task-2337-repro.test.ts:50` | PASS |
| recordStageStats records model for custom agent | `"task-2337: recordStageStats records model for custom agent"`, `test/task-2337-repro.test.ts:54` | PASS |
| Weekly stats report renders model names | `"task-2337: weekly stats report renders model name for custom agent rows"`, `test/task-2337-repro.test.ts:72` | PASS |
| accumulateStageStats preserves model | `"task-2337: accumulateStageStats preserves model for custom agent"`, `test/task-2337-repro.test.ts:88` | PASS |
| All 5 repro tests pass | `npm test -- test/task-2337-repro.test.ts` (5 pass, 0 fail) | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` (build, integration-suite, workflow, custom-agent-smoke all PASS) | PASS |
| Falsifiability rule | ADR 0048 | PASS |

## Next action

CP-2: Fix the model propagation in the recording path — ensure `resolveAgentModel('custom', worktree)` is called and its result flows through `recordStageStatsSafe` → `accumulateStageStats` → stored measurement row. Verify with the reproduction test turning green.
