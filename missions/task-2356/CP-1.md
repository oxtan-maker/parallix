# CP-1 — Production-boundary baseline

## Work summary

Inspected the shared projection path before production edits. Existing production-boundary regressions already cover lifecycle-only completion, current ISO-week zero materialization, offset normalization, canonical cohort metadata, and persisted lane history. The baseline also identified two remaining presentation/contract gaps: FLOW applies the projection-wide provenance sample to unrelated metrics, and it does not render the already-supplied cohort comparison.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Historical replay has a persisted lifecycle baseline | `test/task-2347.02-lifecycle-history.test.ts`, "records a gap-free ordered lane history from backlog entry to closure" | PASS |
| Current ISO week is materialized when it has no completions | `test/task-2347.04-throughput-truthful.test.ts`, "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | PASS |
| Offset-bearing completion timestamps are normalized before week bucketing | `test/task-2347.04-throughput-truthful.test.ts`, "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | PASS |
| Lifecycle completion survives missing telemetry | `src/application/projections/metrics-read-adapter.ts:287`, `test/task-2347.04-throughput-truthful.test.ts` | PASS |
| Review bounce is lifecycle-derived rather than telemetry fix rounds | `src/application/projections/cohorts.ts:256`, `test/task-2347.09-bounce-rate.test.ts` | PASS |
| Integration remains eligible for operational bottleneck selection | `src/application/projections/metrics.ts:465` | PASS |
| FLOW renders metric-specific coverage rather than global provenance n | `src/interfaces/tui/flow-panel.tsx:22`, `src/interfaces/tui/flow-panel.tsx:56` | FAIL |
| FLOW exposes supplied cohort comparison | `src/application/projections/board.ts:146`, `src/interfaces/tui/flow-panel.tsx` | FAIL |
| Primary checkout and worktree share canonical repository scope | `test/task-2347-01-repository-identity-repro.test.ts` | PASS |

Next action: repair temporal replay contracts in `src/application/projections/metrics.ts` and prove the historical state series against persisted lane events.
