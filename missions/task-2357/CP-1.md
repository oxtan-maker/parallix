# CP-1 — Red Baseline

## Summary

All 7 defect regressions exist as test files. At baseline (SHA `f7b31142e`), defects A, B, D, E, F are already fixed. Defects C and G are still broken.

## Red/Green Evidence

| Defect | Test Name | Status | Expected | Actual (Red) | Bug Explanation |
|---|---|---|---|---|---|
| A | `leaves a Thursday-intaked mission absent from Monday, Tuesday and Wednesday` | **Green** | B absent Mon-Wed | PASS | `hasRecordedIntake()` at `metrics.ts:412` checks `transition.from === null`; `entryToMissionTransition()` at `metrics-read-adapter.ts:596` preserves null |
| A | `never reports a completed mission before the week it was intaked` | **Green** | Monday flow=0 | PASS | Same fix covers cumulative flow |
| B | `resolves px stats cohorts to the primary checkout identity, not the worktree path` | **Green** | canonical ID | PASS | `resolveCanonicalRepositoryId()` at `stats-cohorts.ts:209` |
| B | `produces identical BoardMetrics from primary and worktree` | **Green** | same metrics | PASS | Same resolver in `ConcreteMetricsReadAdapter` |
| C | `stores an unknown count as SQL NULL and excludes it from cohort aggregates` | **Red** | observationCount=2, median=1 | observationCount=4, median=0.5 | `MissionOutcome.reviewFixRounds: number` (non-null) at `usage.ts:111`; adapter coerces `?? 0` at `metrics-read-adapter.ts:271`; cohort count uses `members.length` at `cohorts.ts:289` |
| C | `keeps a measured zero distinct from an unknown count in the outcome model` | **Red** | unknown=null | unknown=0 | Same `?? 0` coercion erases null→0 |
| D | `reports exactly the lifecycle-completed missions as outcomes` | **Green** | A,B completed | PASS | `usageRecordsToOutcomes()` at `metrics-read-adapter.ts:283` uses lifecycle `completedAt` |
| D | `gives the shared CLI mission-flow report the same population as the board` | **Green** | same population | PASS | Same lifecycle authority |
| E | `reads only its own repository history for a colliding mission id` | **Green** | own timestamp only | PASS | `deriveLifecycleEntries()` at `metrics-read-adapter.ts:380` filters `data.repositoryId === this.repositoryId` |
| E | `reports the lane age as unavailable when no row can be attributed` | **Green** | unavailable | PASS | Same filter |
| F | `renders the current week as 0 when twelve active missions have never completed` | **Green** | throughput=0 | PASS | `weeklyThroughputSeries()` at `metrics.ts:437-438` takes `hasLifecycleActivity` |
| F | `never lets a previous week of seven leak into a current week of zero` | **Green** | current=0 | PASS | Same logic |
| G | `marks cost low-sample at n=2 while the 30-mission cohort is not` | **Red** | lowSamplePopulation=false, lowSampleByMetric.cost=true | lowSampleByMetric=undefined | `compareCohorts()` at `cohorts.ts:269` uses single `lowSample: members.length < threshold`; no per-metric flag exists |

## Next Action

Fix C (reviewFixRounds nullable end-to-end) and G (per-metric low-sample). Start with C.
