# CP-3 — Consumers migrated to shared semantics

Updated `src/adapters/cli/commands/stats.ts` and
`src/application/projections/metrics-read-adapter.ts` to delegate mission
identity, completion, reporting-window handling, and transition time bucketing
to `statistics-service`. Updated `buildBoardMetrics` and its callers to use the
single named-field input. `metrics.ts` now advances cumulative-flow and
cycle-time history with ordered cursors rather than re-reading transitions for
each instant.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: report and board parity | `"task-2347.08 repro: CLI and board agree on identity, completions, and cycle time"`; `src/application/projections/metrics-read-adapter.ts:189` | Passed |
| SC2: CLI is a semantic adapter | `src/adapters/cli/commands/stats.ts:445`; `src/adapters/cli/commands/stats.ts:784`; `"task-2347.08: CLI delegates identity, completion, and window rules to statistics service"` | Passed |
| SC3: board uses UTC conversion | `src/application/projections/metrics-read-adapter.ts:247`; `src/application/services/statistics-service.ts:58` | Passed |
| SC4: ordered transitions are cursor-evaluated | `src/application/projections/metrics.ts:197`; `"task-2347.08: cumulative flow evaluates ordered transitions once"` | Passed |
| SC5: board metrics has one named input | `src/application/projections/board.ts:205`; `"task-2347.08: board metrics accept named input without positional overload casts"` | Passed |

Next action: Run the mission verification gate, then capture final gate and focused-test evidence in CP-4.
