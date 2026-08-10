# CP-6 — Final certification

## Work summary

Certified the repaired statistics path and updated the operator documentation. The committed implementation preserves lifecycle authority, repository scope, unavailable values, and per-metric cohort coverage; FLOW consumes the projection without recalculating it. The required repository gate passed on the final implementation tree before this checkpoint record was added.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Temporal replay, explicit zero week, and offset handling remain certified | `src/application/projections/metrics.ts:504`, "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | PASS |
| Repository-scoped board/CLI agreement remains certified | "task-2347.08 repro: CLI and board agree on identity, completions, and cycle time" | PASS |
| Cohort metrics expose real observation counts | `src/application/projections/cohorts.ts:284`, "SC3: the user_value cohort is computed from its own three missions" | PASS |
| FLOW renders projection-owned cohorts and coverage | `src/interfaces/tui/flow-panel.tsx:32`, "FLOW panel renders supplied cohort values with metric-specific coverage in wide and narrow layouts" | PASS |
| Documentation describes population and per-metric coverage truthfully | `docs/authority-reference.md:325`, `docs/tui-board.md:77` | PASS |
| Required final gate passed | `./scripts/verify-local.sh all` | PASS |
| Mandatory integration gate passed | `./scripts/verify-local.sh integrate` | PASS |

## Acceptance evidence

| AC | Result | Production evidence | Regression test | Why the test would catch the old bug |
| --- | --- | --- | --- | --- |
| #1 | PASS | `src/application/projections/metrics.ts:504` | "records a gap-free ordered lane history from backlog entry to closure" | Intake replay rejects current-state seeding. |
| #2 | PASS | `src/application/projections/metrics.ts:509` | `test/task-2347.02-lifecycle-history.test.ts` | Earlier lane states differ from today's done state. |
| #3 | PASS | `src/application/projections/metrics.ts:508` | `test/task-2347.02-lifecycle-history.test.ts` | Legacy fallback is excluded for an intake history. |
| #4 | PASS | `src/application/projections/metrics.ts:399` | "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | Empty current week must be materialized. |
| #5 | PASS | `src/application/projections/metrics.ts:403` | "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | Offset closure changes ISO-week bucket if mishandled. |
| #6 | PASS | `src/application/projections/cohorts.ts:284` | "SC3: the user_value cohort is computed from its own three missions" | Token coverage is 2, not population 3. |
| #7 | PASS | `src/application/projections/cohorts.ts:268` | "SC3: the user_value cohort is computed from its own three missions" | Separate population and count assertions fail if conflated. |
| #8 | PASS | `src/application/projections/cohorts.ts:284` | `test/task-2347.09-cohort-presentation.test.ts` | Rendered figures carry their own coverage. |
| #9 | PASS | `src/interfaces/tui/flow-panel.tsx:32` | "FLOW panel renders supplied cohort values with metric-specific coverage in wide and narrow layouts" | Removing projection cohort rendering loses output. |
| #10 | PASS | `src/interfaces/tui/flow-panel.tsx:42` | "FLOW panel renders supplied cohort values with metric-specific coverage in wide and narrow layouts" | Omitted cohort metrics fail direct display assertions. |
| #11 | PASS | `src/application/projections/metrics-read-adapter.ts:107` | "repository id from mission worktree path equals id from primary checkout" | Path identity would split one repository. |
| #12 | PASS | `src/application/projections/metrics-read-adapter.ts:107` | "metrics for named repository exclude legacy-unscoped rows" | Broad query contaminates the result. |
| #13 | PASS | `src/application/projections/metrics-read-adapter.ts:280` | "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | No-telemetry completion would disappear. |
| #14 | PASS | `src/application/projections/metrics-read-adapter.ts:287` | "task-2347.08 repro: CLI and board agree on identity, completions, and cycle time" | Divergent semantic owners change agreement. |
| #15 | PASS | `docs/authority-reference.md:325` | `docs/authority-reference.md` | Usage is documented separately from lifecycle completion. |
| #16 | PASS | `src/application/projections/cohorts.ts:250` | "SC4: the bounce rate ignores pr_fix_rounds, which disagrees with lane history" | Fix-round substitution changes the rate. |
| #17 | PASS | `src/application/projections/cohorts.ts:277` | `test/task-2347.09-bounce-rate.test.ts` | Telemetry fix rounds remain separately named. |
| #18 | PASS | `src/application/projections/metrics.ts:465` | "bottleneck: integration lane NOT selected as bottleneck" | Integration eligibility assertion guards policy. |
| #19 | PASS | `src/application/projections/metrics.ts:465` | "bottleneck: done lane NOT selected as bottleneck when active has stall" | Done inclusion changes selection. |
| #20 | PASS | `src/application/projections/metrics-read-adapter.ts:252` | `test/task-2347-01-repository-identity-repro.test.ts` | Wrong writer identity splits or merges rows. |
| #21 | PASS | `src/application/projections/metrics-read-adapter.ts:42` | `test/task-2347.08-own-statistics-semantics-repro.test.ts` | Shared projection path is exercised. |
| #22 | PASS | `src/application/projections/cohorts.ts:276` | "an unmeasured figure renders as n/a rather than zero" | Missing input stays unavailable. |
| #23 | PASS | `test/task-2347.04-throughput-truthful.test.ts` | "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | Fixture includes offset, zero week, and no telemetry. |
| #24 | PASS | `test/task-2347.09-cohort-metrics.test.ts` | "SC3: the user_value cohort is computed from its own three missions" | Seed arithmetic is hand-computed. |
| #25 | PASS | `src/application/projections/metrics-read-adapter.ts:99` | `test/task-2347.09-cohort-presentation.test.ts` | BoardMetrics receives production cohorts. |
| #26 | PASS | `test/task-2347.08-own-statistics-semantics-repro.test.ts` | "task-2347.08 repro: CLI and board agree on identity, completions, and cycle time" | Same fixture detects population disagreement. |
| #27 | PASS | `test/task-2347.04-throughput-truthful.test.ts` | "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | Named old behavior changes expected output. |
| #28 | PASS | `docs/authority-reference.md:325` | `docs/tui-board.md` | Operators see final coverage semantics. |
| #29 | PASS | `./scripts/verify-local.sh all` | `./scripts/verify-local.sh all` | Final verifier is required. |

Next action: hand the committed mission artifacts to Parallix for lifecycle handling.
