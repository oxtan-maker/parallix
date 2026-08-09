# CP-1: Reproduction test authored

## Summary

Authored `test/task-2347.05-cycle-time-vs-runtime.test.ts`, a red-to-green
reproduction suite for the conflation of agent runtime with lifecycle cycle
time. The fixture models the scenario named in the Backlog description: a
mission that enters the backlog at `2026-08-01T10:00:00Z` and closes at
`2026-08-02T12:00:00Z` (1560 minutes of lifecycle) while its agents ran for
22 + 15 = 37 minutes across two usage rows. The two quantities differ by
1523 minutes, far above the 1-minute floor SC1 requires.

The suite drives `ConcreteMetricsReadAdapter` through in-memory fakes for
`BoardLaneEventRepository` and `UsageRepository`, so lifecycle cycle time is
asserted from lane events independently of usage rows (AC #2). It covers SC1
through SC6, including a lane-event-free fallback case and a
`duration_minutes`-absent case.

All 8 tests fail on the current tree. Three distinct failure modes are
present, each pointing at a piece of the defect:

- `adapter(...).readOutcomes is not a function` — the adapter exposes no way to
  observe the outcomes it derives, and `usageRecordsToOutcomes` is private.
- `metrics.medianAgentRuntime` is undefined — no board metric separates agent
  runtime from cycle time.
- The FLOW panel renders neither `Median lifecycle cycle time` nor
  `Median agent runtime`.

No production code has been changed at this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test file exists at the mission-declared path | `test/task-2347.05-cycle-time-vs-runtime.test.ts` | PASS |
| SC1 red: cycle time asserted as lifecycle, not summed runtime, with a >1 minute gap | `test/task-2347.05-cycle-time-vs-runtime.test.ts:144`, `"SC1: cycle time reflects the lifecycle wall clock, not the summed agent runtime"` | PASS (fails as expected) |
| SC2/SC3 red: `runs` populated per usage record | `test/task-2347.05-cycle-time-vs-runtime.test.ts:158`, `"SC2/SC3: every outcome carries one AgentRunMeasurement per usage record"` | PASS (fails as expected) |
| SC4 red: `medianStateTimes` lifecycle-derived | `test/task-2347.05-cycle-time-vs-runtime.test.ts:200`, `"SC4: medianStateTimes reports the lifecycle cycle time"` | PASS (fails as expected) |
| SC5 red: board surfaces and labels the two quantities distinctly | `"SC5: FLOW panel labels lifecycle cycle time and agent runtime distinctly"` | PASS (fails as expected) |
| SC6 red: `CompletedMissionStatistics` sums runtime from `outcome.runs` | `src/domain/usage.ts:181`, `"SC6: CompletedMissionStatistics still sums runtime from outcome.runs"` | PASS (fails as expected) |
| Defect located in the adapter under test | `src/application/projections/metrics-read-adapter.ts:153` (sums `duration_minutes` into `cycleTimeMinutes`), `src/application/projections/metrics-read-adapter.ts:175` (`runs: []`) | PASS |
| Whole suite red before any fix | `npx tsx --test test/task-2347.05-cycle-time-vs-runtime.test.ts` — 8 tests, 8 failing | PASS |

Next action: CP-2 — verify `AgentRunMeasurement` in `src/domain/usage.ts:82` carries every field a `UsageRecord` (`src/application/ports/mission-measurements.ts:1`) can supply, and confirm `MissionOutcome` needs no interface change.
