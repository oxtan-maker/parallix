# CP-2 — Cohort grouping and per-cohort metrics

## Summary

Added `src/application/projections/cohorts.ts`: a pure module that groups
completed missions by an experiment dimension and computes each cohort's
figures beside its sample size.

- `CohortDimension` (`src/application/projections/cohorts.ts:18`) covers
  `label`, `implementer`, `model`, `provider` and `date-range`. `cohortKeys()`
  puts a mission in every cohort it genuinely belongs to (two labels means two
  cohorts) and a mission with no value for the dimension lands in
  `UNASSIGNED_COHORT` rather than disappearing from the comparison.
- `compareCohorts()` (`src/application/projections/cohorts.ts:233`) returns
  `n`, median and nearest-rank p75 cycle time, median `active` and `review`
  dwell, review bounce rate, median fix rounds, and tokens, agent runtime, cost
  and net engineering lines per completed mission. Cohorts are sorted by
  descending `n` then key, so output is deterministic.
- `n` and `lowSample` are fields of `CohortMetrics`
  (`src/application/projections/cohorts.ts:39`), not of a presentation layer, so
  no consumer can render a cohort figure without having its sample size in hand.
  `LOW_SAMPLE_THRESHOLD` is 5.
- Unmeasured quantities stay `null` rather than becoming zero: a per-mission
  mean is taken over the missions that measured the quantity, and a cohort where
  nothing reached review reports `reviewBounceRate: null`, which is a different
  claim from a measured zero.
- Dwell is read from lane history, summing every closed stay in a lane so a
  bounced mission's two `active` stays count once as its total dwell. Open
  intervals are excluded, so a mission still sitting in a lane never understates
  the cohort.
- `LaneInterval` (`src/application/projections/metrics.ts:38`) gained
  `missionId` so dwell can be attributed per mission. No existing metric series
  changed — `buildMetrics` and every series function are untouched, per the
  mission's restricted-area rule for `metrics.ts`.

`test/task-2347.09-cohort-metrics.test.ts` seeds 8 completed missions (5
`ai_sdlc`, 3 `user_value`) from a declared table and asserts hand-computed
values for both label groups.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3: a cohort comparison over two label groups returns `n`, median cycle time, p75 cycle time, median active dwell, median review dwell, review bounce rate, tokens/mission, cost/mission, NEL, asserted against hand-computed values from 6+ seeded missions | `test/task-2347.09-cohort-metrics.test.ts`; tests `"SC3: the ai_sdlc cohort reports every figure with its sample size"` (n=5, median 300, p75 400, active dwell 30, review dwell 25, bounce 2/5, tokens 3000, cost 3, runtime 30, NEL 30) and `"SC3: the user_value cohort is computed from its own three missions"` (n=3, median 120, p75 900, active dwell 200, review dwell 70, bounce 0, tokens 200, cost 1.5, runtime 10, NEL 200) | PASS |
| Eight seeded missions partition into exactly the two label cohorts | test `"SC3: the two label cohorts partition the eight seeded missions"` in `test/task-2347.09-cohort-metrics.test.ts` | PASS |
| Every cohort carries `n` in the computed model, not only in a view | `src/application/projections/cohorts.ts:39` (`CohortMetrics.n`, `CohortMetrics.lowSample`) | PASS |
| p75 is a nearest-rank observed value | `src/application/projections/cohorts.ts:99`; test `"nearest-rank p75 returns an observed value, never an interpolated one"` | PASS |
| Grouping supports model, provider and date-range dimensions | `src/application/projections/cohorts.ts:18`; test `"cohorts can be grouped by model, provider, and closing date range"` | PASS |
| Missions are never silently dropped from a comparison | tests `"a mission with two labels joins both cohorts instead of being dropped"` and `"a mission with no value for the dimension lands in the unassigned cohort"` | PASS |
| `metrics.ts` restricted area respected: no existing series changed | `src/application/projections/metrics.ts:38` is the only edit (added `missionId` to `LaneInterval`); `npm test -- test/board-metrics.test.ts` and `test/domain-projections.test.ts` pass unchanged (40 pass, 0 fail with the lifecycle-history and dwell repro tests) | PASS |
| CP-2 tests pass | `npm test -- test/task-2347.09-cohort-metrics.test.ts` — 7 pass, 0 fail | PASS |
| Production files lint and typecheck clean | `npx eslint src/application/projections/cohorts.ts src/application/projections/metrics.ts` and `npx tsc --noEmit --project tsconfig.json` report no findings | PASS |

Next action: add `test/task-2347.09-bounce-rate.test.ts` proving the bounce rate
comes from `review → active` lane transitions and not from `pr_fix_rounds` —
3 missions entering review, 2 bounces, expected rate 0.667 — with `pr_fix_rounds`
seeded to a conflicting value so the two sources cannot be confused (CP-3).
