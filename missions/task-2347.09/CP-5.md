# CP-5 — Verification gate and final Goal Check

## Summary

Both declared gates pass on the committed tree at `7e44c5764`:

- `./scripts/verify-local.sh all` — exit 0, **1880 pass, 0 fail**.
- `./scripts/verify-local.sh static-analysis` — `=== Static Analysis Gate: ALL
  STAGES PASSED ===` across all four stages (ESLint on `src/`, `npm run
  typecheck`, test-hygiene, test typecheck under `tsconfig.test.json`).

The working tree is clean; every mission and checkpoint document is committed.

### What the mission delivered

Operators can now answer "did this workflow change improve delivery?" by
grouping completed missions along an experiment dimension and reading each
cohort's figures beside its sample size.

- **CP-1** — `MissionOutcome` (`src/domain/usage.ts:102`) carries `labels`,
  `implementer`, `modelsInvolved`, `totalInputAndOutputTokens`, `totalCostUsd`,
  `totalToolCalls` and `closedAt`, populated by `usageRecordsToOutcomes`
  (`src/application/projections/metrics-read-adapter.ts:165`) instead of being
  discarded.
- **CP-2** — `src/application/projections/cohorts.ts` groups missions by
  `label`, `implementer`, `model`, `provider` or `date-range` and computes `n`,
  median and nearest-rank p75 cycle time, median `active` and `review` dwell,
  review bounce rate, median fix rounds, and tokens, agent runtime, cost and NEL
  per completed mission.
- **CP-3** — the bounce rate reads `review → active` lane transitions
  (`src/application/projections/cohorts.ts:148`), never `pr_fix_rounds`.
- **CP-4** — `px stats cohorts` (`src/adapters/cli/commands/stats-cohorts.ts`)
  and `BoardMetrics.cohorts` (`src/application/projections/board.ts:146`) expose
  the comparison; `n` is a fixed column and sub-threshold cohorts are marked
  low-sample.

### Repairs to invariants that were already red at the branch tip

These were not optional: SC7 requires both gates green on the final tree, and
each failure sat on the types or citations this mission moved.

- Test typecheck (8 errors at `b74ad0932`): fixtures constructed `MissionOutcome`
  and `BoardMetrics` without the fields TASK-2347.08 added, plus one
  `trigger: 'close'` that is not a `MissionTransition` trigger. Fixed in CP-1
  via `test/fixtures/mission-outcome.ts`.
- `test/task-2347.08-own-statistics-semantics-repro.test.ts` `require`d
  `../.test-runtime/adapters/cli/commands/stats.js`, a path that does not exist:
  the file failed outright and tripped the ESM-only guard on both `require(` and
  `.test-runtime`. It now uses the same default ESM import as
  `test/stats-report.test.ts`.
- ESLint reported one unused import (`isCompletedStatisticsRow` in `stats.ts`).
- Two `completedMissionStatistics` citations pointed at `src/domain/usage.ts:156`
  after the CP-1 helper extraction moved it to line 197.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `MissionOutcome` declares `labels`, `implementer`, `modelsInvolved`, `totalInputAndOutputTokens`, `totalCostUsd`, `totalToolCalls`, `closedAt` | `src/domain/usage.ts:102`; test `"SC1: a constructed mission outcome carries every cohort dimension and total"` in `test/domain-outcomes.test.ts` | PASS |
| SC2: `usageRecordsToOutcomes` populates all new fields from `UsageRecord` rows and `BoardLaneEventEntry` data | `src/application/projections/metrics-read-adapter.ts:165`; test `"SC2: usageRecordsToOutcomes populates the cohort dimensions from usage and lane rows"` asserts labels `['user_value']`, implementer `codex`, both provider/model pairings, 2100 tokens, 0.75 USD, 17 tool calls and the lane-derived `closedAt` | PASS |
| SC3: a cohort comparison over two label groups returns `n`, median cycle time, p75 cycle time, median active dwell, median review dwell, review bounce rate, tokens/mission, cost/mission and NEL, asserted against hand-computed values from 6+ seeded missions | `test/task-2347.09-cohort-metrics.test.ts` (8 seeded missions); tests `"SC3: the ai_sdlc cohort reports every figure with its sample size"` (n=5, median 300, p75 400, active 30, review 25, bounce 2/5, tokens 3000, cost 3, runtime 30, NEL 30) and `"SC3: the user_value cohort is computed from its own three missions"` (n=3, median 120, p75 900, active 200, review 70, bounce 0, tokens 200, cost 1.5, runtime 10, NEL 200) | PASS |
| SC4: review bounce rate computed from `review → active` transitions in lane history, not `pr_fix_rounds`; 3 missions, 2 with bounces, expected 2/3 | `src/application/projections/cohorts.ts:148`; tests `"SC4: review bounce rate is 2/3 when 2 of 3 missions bounce out of review"` and `"SC4: the bounce rate ignores pr_fix_rounds, which disagrees with lane history"` in `test/task-2347.09-bounce-rate.test.ts` (fix rounds seeded 0/0/5 so a fix-round rate would be 5/3) | PASS |
| SC5: no cohort figure rendered without its sample size `n` | `src/adapters/cli/commands/cohort-report.ts:16` (`n` is a fixed column, not an option); tests `"SC5: every cohort row carries an n column"` and `"SC5: no rendered figure appears on a line without its sample size"` in `test/task-2347.09-cohort-presentation.test.ts` | PASS |
| SC6: a cohort with `n < 5` is marked low-sample rather than presented as comparable | test `"SC6: a cohort of 3 missions is marked low-sample, not presented as comparable"`; `LOW_SAMPLE_THRESHOLD` at `src/application/projections/cohorts.ts:24` | PASS |
| SC7: `./scripts/verify-local.sh all` passes on the final tree | `./scripts/verify-local.sh all` — exit 0, 1880 pass, 0 fail on commit `7e44c5764` | PASS |
| Cohort comparison exposed through `px stats` | `src/adapters/cli/commands/stats.ts:2175`; test `"px stats cohorts renders the comparison with sample sizes from stored history"` | PASS |
| Cohort comparison exposed through the board read model | `src/application/projections/board.ts:146`; test `"the board read model exposes the cohort comparison with sample sizes"` | PASS |
| Restricted area: `completedMissionStatistics()` signature and return fields unchanged | `src/domain/usage.ts:197`; tests `"completed mission statistics retain model involvement across stage and role"` and `"a mission with no recorded runs reports unknown totals, not zero work"` pass unchanged | PASS |
| Restricted area: `buildMetrics` series unchanged; cohorts added as an optional `BoardMetrics` field | `src/application/projections/metrics.ts:38` is the only `metrics.ts` edit (`missionId` on `LaneInterval`); `src/application/projections/board.ts:146` is optional | PASS |
| Restricted area: `--weekly`, `--range` and `--mission` paths in `stats.ts` unmodified | test `"renderMissionPhaseReport renders phase table"` and the weekly/range suites stay green in `./scripts/verify-local.sh all` | PASS |
| DoD #2: lint and static analysis clean on every changed file | `./scripts/verify-local.sh static-analysis` — all four stages pass | PASS |
| DoD #3: no focused or unannotated skipped tests introduced | test-hygiene stage of `./scripts/verify-local.sh static-analysis` reports `PASS: no test-hygiene violations`; `skipped 0`, `todo 0` in the suite summary | PASS |
| DoD #5: docs reflect the user-facing change | `docs/authority-reference.md:315` (invocation) and `docs/authority-reference.md:323` (behaviour, low-sample rule, bounce-rate source) | PASS |

Next action: hand off to review — the branch is ready for `px review
task-2347.09`, with the cohort dimension choice (`label` as the board default in
`src/application/projections/metrics-read-adapter.ts:91`) and the nearest-rank
p75 definition (`src/application/projections/cohorts.ts:99`) as the two design
decisions most worth a reviewer's attention.
