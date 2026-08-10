# CP-2 — Persistence and lifecycle semantics

Consolidated production board composition onto the repository identity already resolved by mission composition, so a worktree cannot produce a competing board scope. Lifecycle projection now creates a delivered outcome from the first `integration → done` event even without telemetry, rejects telemetry-only completion when a known lifecycle is incomplete, and preserves the first delivery completion across a later administrative close. The shared projection now emits the injected clock’s current ISO week with an explicit zero and starts historical flow from recorded lifecycle entry rather than today’s state.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 primary checkout and worktree use the composed repository identity for board reads | `src/composition/application-services.ts:221`, `src/composition/production-capabilities.ts:37`, `test/production-composition-capabilities.test.ts` | PASS |
| SC2 lifecycle completion includes telemetry-free missions and rejects incomplete lifecycle telemetry | `src/application/projections/metrics-read-adapter.ts:259`, "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | PASS |
| SC3 state mutation and event persistence are atomic; first delivery completion remains authoritative | `src/adapters/sqlite/mission-store.ts:233`, `src/application/projections/metrics-read-adapter.ts:272`, `test/task-2347.02-lifecycle-history.test.ts` | PASS |
| SC4 historical flow starts from events and lane age continues from injected `asOf` clock | `src/application/projections/metrics.ts:504`, `test/task-2347-06-repro.test.ts` | PASS |
| SC5 throughput buckets normalized completion instants and emits the current zero week | `src/application/projections/metrics.ts:398`, "lifecycle completion survives absent telemetry, ignores later close, and emits current-week zero" | PASS |
| SC6 lifecycle cycle time remains independent of telemetry runtime | `src/application/projections/metrics-read-adapter.ts:275`, "SC1: cycle time reflects the lifecycle wall clock, not the summed agent runtime" | PASS |

Next action: Move cohort dimensions and per-metric coverage fully onto canonical Mission and shared projection inputs, then finish compact board/CLI comparison semantics in CP-3.
