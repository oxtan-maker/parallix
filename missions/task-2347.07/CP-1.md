# CP-1 — Adapter failure reproduction

Added the required red-to-green reproduction test. It configures the metrics adapter to throw during board projection construction and now verifies the projection reports unavailable statistics without default metric values.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Adapter failure is explicit and never renders default metrics | `src/application/projections/board-readers.ts:178`, `"metrics-read adapter failure projects explicit unavailable statistics instead of default zero values"` | PASS |
| Projection carries provenance | `src/application/projections/board.ts:142`, `test/task-2347.07-statistics-provenance.repro.test.ts` | IN PROGRESS |
| No-completions and no-telemetry are distinct | `src/application/projections/metrics-read-adapter.ts:87` | IN PROGRESS |
| Failed recording remains non-blocking and observable | `src/application/recording/board-event-recorder.ts:53` | IN PROGRESS |
| Board labels health and sample size beside rates and medians | `src/interfaces/tui/flow-panel.tsx:52` | IN PROGRESS |
| Required final verification passes | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` | PENDING |

Next action: define controlled provenance and health-state assertions in `test/task-2347.07-statistics-provenance.repro.test.ts`.
