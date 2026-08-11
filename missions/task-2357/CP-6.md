# CP-6 — Mutation Proof

## Summary

Demonstrated former C and G behavior fails the new regressions. Restored correct implementation and confirmed green.

## Defect C Mutation

| Step | Command | Result |
|---|---|---|
| Former: `?? 0` + `members.length` | Reverted `metrics-read-adapter.ts:271` to `?? 0`, `metrics-read-adapter.ts:300` to `0`, `cohorts.ts:289` to `members.length` | Both C tests **RED** — `✖ stores an unknown count as SQL NULL` and `✖ keeps a measured zero distinct` |
| Fixed: `?? null` + filter nulls | Restored changes | Both C tests **GREEN** |

## Defect G Mutation

| Step | Command | Result |
|---|---|---|
| Former: single `lowSample` | `git stash` cohorts.ts + cohort-report.ts (reverts to HEAD baseline) | G test **RED** — `✖ marks cost low-sample at n=2` (lowSampleByMetric undefined) |
| Fixed: `lowSampleByMetric` | `git stash pop` (restores changes) | G test **GREEN** |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| C: former `?? 0` breaks null/zero distinction | Reverted `src/application/projections/metrics-read-adapter.ts:271` to `?? 0`, line 300 to `0`, `src/application/projections/cohorts.ts:289` to `members.length`; test `test/task-2357.c-unknown-review-fix-rounds.test.ts` cases "stores an unknown count as SQL NULL" and "keeps a measured zero distinct" both RED | Green |
| C: restored fix passes | `src/application/projections/metrics-read-adapter.ts:271` `?? null`, `:300` `null`, `src/application/projections/cohorts.ts:289` filter nulls; test `test/task-2357.c-unknown-review-fix-rounds.test.ts` both cases GREEN | Green |
| G: former single `lowSample` breaks per-metric coverage | Reverted `src/application/projections/cohorts.ts` + `src/application/projections/cohort-report.ts` to HEAD baseline; test `test/task-2357.g-per-metric-evidence.test.ts` case "marks cost low-sample at n=2" RED | Green |
| G: restored fix passes | `src/application/projections/cohorts.ts` computes `lowSampleByMetric`; `src/application/projections/cohort-report.ts` reads per-metric flags; test `test/task-2357.g-per-metric-evidence.test.ts` GREEN | Green |

## Next Action

CP-7 — contradiction sweep: inspect remaining suspicious semantic matches.
