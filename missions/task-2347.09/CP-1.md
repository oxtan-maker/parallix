# CP-1 — MissionOutcome carries the cohort dimensions

## Summary

`MissionOutcome` now carries the experiment dimensions and per-mission totals a
cohort comparison slices on, and `ConcreteMetricsReadAdapter.usageRecordsToOutcomes`
populates them instead of discarding them.

Work done:

- Extended `MissionOutcome` (`src/domain/usage.ts:102`) with `labels`,
  `implementer`, `modelsInvolved`, `totalInputAndOutputTokens`, `totalCostUsd`
  and `totalToolCalls`. `closedAt` was already declared and is retained.
- Extracted the three derivations that both the projection and
  `completedMissionStatistics()` need into exported domain helpers —
  `sumMeasured`, `modelInvolvement`, `totalInputAndOutputTokens`
  (`src/domain/usage.ts:162`) — and rewired `completedMissionStatistics()` to
  call them, so the two paths cannot drift. Its signature and return fields are
  unchanged, per the mission's restricted-area rule.
- `usageRecordsToOutcomes` (`src/application/projections/metrics-read-adapter.ts:165`)
  now accumulates each mission's classification values and emits the six new
  fields. Labels come from the `classification` column — the only place the
  board's label dimension reaches telemetry — normalised through
  `missionLabels()`. An unclassified mission gets an empty label list rather
  than a fabricated one. `implementer` reads implementer-role runs only, so a
  cohort keyed on implementer is not split by who reviewed the mission, and an
  unparseable agent name stays `null` instead of collapsing to the `unknown`
  family. The totals use all-measured-or-null semantics, so a run missing a
  column makes the whole total unavailable instead of reporting a partial sum
  that reads as a smaller true value.
- Added two test fixtures: `test/fixtures/mission-outcome.ts` (a fully populated
  `MissionOutcome` builder) and `test/fixtures/metrics-adapter.ts` (in-memory
  lane-event and usage repositories plus a `metricsAdapter()` helper), reused by
  the CP-2/CP-3 work.

### Baseline repair included

`npx tsc --noEmit --project tsconfig.test.json` — stage 4 of
`./scripts/verify-local.sh static-analysis` — was already red at the branch tip
(commit `b74ad0932`) with 8 errors: test fixtures constructing `MissionOutcome`
without `createdAt`/`closedAt` and `BoardMetrics` without `medianAgentRuntime`,
both fields added by TASK-2347.08, plus one `trigger: 'close'` that is not a
`MissionTransition` trigger. Those sites are the same construction sites this
checkpoint extends, so they are repaired here rather than left to fail SC7:
the outcome literals now call `missionOutcome()`, the two `BoardMetrics`
fixtures declare `medianAgentRuntime`, and the invalid trigger became
`'integrate'` (the series under test reads only `to`). Test typecheck is now
clean, verified by re-running the command above.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `MissionOutcome` declares `labels`, `implementer`, `modelsInvolved`, `totalInputAndOutputTokens`, `totalCostUsd`, `totalToolCalls`, `closedAt` | `src/domain/usage.ts:102`; test `"SC1: a constructed mission outcome carries every cohort dimension and total"` in `test/domain-outcomes.test.ts` | PASS |
| SC2: `usageRecordsToOutcomes` populates all new fields from `UsageRecord` rows and `BoardLaneEventEntry` data | `src/application/projections/metrics-read-adapter.ts:165`; test `"SC2: usageRecordsToOutcomes populates the cohort dimensions from usage and lane rows"` asserts labels `['user_value']`, implementer `codex`, both provider/model pairings, 2100 tokens, 0.75 USD, 17 tool calls, `closedAt` from the lane event | PASS |
| Unmeasured telemetry is not fabricated as zero | test `"SC2: an unmeasured column leaves the affected total unavailable, not zero"` in `test/domain-outcomes.test.ts` | PASS |
| `completedMissionStatistics()` signature and return fields unchanged (restricted area) | `src/domain/usage.ts:197`; existing tests `"completed mission statistics retain model involvement across stage and role"` and `"a mission with no recorded runs reports unknown totals, not zero work"` still pass | PASS |
| Test typecheck clean (was red at branch tip) | `npx tsc --noEmit --project tsconfig.test.json` reports no output | PASS |
| CP-1 tests pass | `npm test -- test/domain-outcomes.test.ts` — 8 pass, 0 fail | PASS |
| Touched production files lint clean | `npx eslint src/domain/usage.ts src/application/projections/metrics-read-adapter.ts` reports no findings | PASS |

Next action: build `src/application/projections/cohorts.ts` with the cohort
grouping function and per-cohort metrics (n, median/p75 cycle time, median
active and review dwell, tokens/runtime/cost per mission, NEL), covered by
`test/task-2347.09-cohort-metrics.test.ts` with hand-computed values for two
label groups across 6 seeded missions (CP-2).
