# CP-2 — Temporal Authority (A, F, E)

## Summary

Defects A (historical pre-intake), F (measured zero), and E (repository-scoped legacy) were already fixed at baseline. Proved by green regression tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A: Missions absent before intake | `metrics.ts:407-415` `hasRecordedIntake()` checks `transition.from === null`; `metrics.ts:552-553` filters `historicalInitialStates`; test `task-2357.a-historical-intake.test.ts` "leaves a Thursday-intaked mission absent" PASS | Green |
| A: No self-transition heuristic | `metrics.ts:401-405` docs: "deliberately not `from === to`"; intake is `from === null` only | Green |
| A: No current-state seeding | `metrics.ts:552-553` excludes missions with recorded intake from `historicalInitialStates` | Green |
| F: Zero completions = measured zero | `metrics.ts:437-438` `weeklyThroughputSeries` takes `hasLifecycleActivity`; `metrics.ts:558` passes `transitions.length > 0`; test `task-2357.f-measured-zero-throughput.test.ts` PASS | Green |
| F: Prior nonzero leaks not into current zero | `metrics.ts:448-452` current week injected via `asOf`; test "never lets a previous week of seven leak" PASS | Green |
| E: Repository-scoped legacy fallback | `metrics-read-adapter.ts:378-380` filters `data.repositoryId === this.repositoryId`; test `task-2357.e-legacy-history-scope.test.ts` PASS | Green |
| E: Cross-repo isolation | Same filter; test "reports the lane age as unavailable when no row can be attributed" PASS | Green |

## Next Action

CP-3 — verify identity and completion authority (B, D) already satisfied at baseline.
