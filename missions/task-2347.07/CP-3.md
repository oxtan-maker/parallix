# CP-3 — Non-blocking write-failure accounting

`BoardEventRecorder` now exposes its failed-write count. `recordLaneTransitionSafely` increments that counter only when append throws and still resolves `false`, preserving the authoritative transition path.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Adapter failure is explicit and never renders default metrics | `src/application/projections/board-readers.ts:181`, `"metrics-read adapter failure projects explicit unavailable statistics instead of default zero values"` | PASS |
| Projection carries provenance | `src/application/projections/board.ts:142`, `"metrics projection reports controlled provenance and distinguishes no-completions from no-telemetry"` | PASS |
| No-completions and no-telemetry are distinct | `src/application/projections/metrics-read-adapter.ts:88`, `test/task-2347.07-statistics-provenance.repro.test.ts` | PASS |
| Failed recording remains non-blocking and observable | `src/application/recording/board-event-recorder.ts:40`, `"counts a failed write while preserving the non-blocking result"` | PASS |
| Board labels health and sample size beside rates and medians | `src/interfaces/tui/flow-panel.tsx:52` | IN PROGRESS |
| Required final verification passes | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` | PENDING |

Next action: verify statistics labels and sample-size rendering in `test/tui-flow-panel.test.ts`.
