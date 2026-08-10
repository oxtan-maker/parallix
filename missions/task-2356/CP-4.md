# CP-4 — Metric contract correction

## Work summary

Added metric-specific observation counts to the existing cohort projection and carried them into the shared CLI report. Population `n` remains distinct from each metric's observation count; unavailable values stay unavailable. Lifecycle review-bounce derivation and review-fix telemetry remain separately named.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Cohort population and metric observation coverage are distinct | `src/application/projections/cohorts.ts:57`, "SC3: the user_value cohort is computed from its own three missions" | PASS |
| Runtime, cost, NEL, dwell and bounce use their own observed populations | `src/application/projections/cohorts.ts:250`, `src/application/projections/cohorts.ts:281` | PASS |
| CLI renders each supplied figure with its metric-specific n | `src/adapters/cli/commands/cohort-report.ts:29`, "SC5: no rendered figure appears on a line without its sample size" | PASS |
| Lifecycle review bounce remains separate from review-fix rounds | `src/application/projections/cohorts.ts:274`, `test/task-2347.09-bounce-rate.test.ts` | PASS |
| Unmeasured data remains unavailable rather than zero | `src/adapters/cli/commands/cohort-report.ts:31`, "an unmeasured figure renders as n/a rather than zero" | PASS |
| Targeted metric-contract tests pass | `npx tsx --test test/task-2347.09-cohort-metrics.test.ts test/task-2347.09-cohort-presentation.test.ts` | PASS |

Next action: render the supplied cohort projection in FLOW in both wide and narrow layouts without calculating statistics in the component.
