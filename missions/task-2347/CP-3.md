# CP-3 — Projection, cohorts, and presentation

Kept the existing application projection as the sole statistics model and bound its cohort labels and implementer to canonical Mission metadata supplied by production board composition. Telemetry continues to supply only runtime/provider/model measurements, so an imported or stale telemetry classification cannot silently move a completed mission between experiment cohorts. The established board and `px stats cohorts` comparison continues to consume the same `CohortComparison` projection with sample-size and unavailable-value rendering.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC6 missing execution measurements remain unavailable instead of numeric zero | `src/application/projections/metrics-read-adapter.ts:367`, "an unmeasured figure renders as n/a rather than zero" | PASS |
| SC7 bounce rate remains lifecycle-derived and separate from fix rounds | `src/application/projections/cohorts.ts:143`, `test/task-2347.09-bounce-rate.test.ts` | PASS |
| SC8 cohort label and implementer use canonical Mission metadata; presentation carries sample sizes | `src/composition/board-projection.ts:62`, `src/application/projections/metrics-read-adapter.ts:195`, "cohort labels and implementer come from canonical Mission metadata, not telemetry", `test/task-2347.09-cohort-presentation.test.ts` | PASS |
| SC9 board and CLI share application projection/cohort calculations | `src/application/projections/metrics-read-adapter.ts:157`, `src/adapters/cli/commands/stats-cohorts.ts`, "task-2347.08 repro: CLI and board agree on identity, completions, and cycle time" | PASS |

Next action: Build the deterministic production-composition lifecycle fixture, reconcile any remaining obsolete compatibility paths, update child-task evidence without changing lifecycle metadata, and run the declared mission gate.
