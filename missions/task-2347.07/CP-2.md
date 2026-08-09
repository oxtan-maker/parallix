# CP-2 — Provenance and health contract

Added typed metrics provenance and health fields. The concrete adapter now records repository identity, evaluation window, sample size, newest event timestamp, rejected-or-missing-identity rows, adapter success, and distinct no-completions, no-telemetry, pre-lifecycle, and partial states.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Adapter failure is explicit and never renders default metrics | `src/application/projections/board-readers.ts:181`, `"metrics-read adapter failure projects explicit unavailable statistics instead of default zero values"` | PASS |
| Projection carries provenance | `src/application/projections/board.ts:142`, `"metrics projection reports controlled provenance and distinguishes no-completions from no-telemetry"` | PASS |
| No-completions and no-telemetry are distinct | `src/application/projections/metrics-read-adapter.ts:88`, `test/task-2347.07-statistics-provenance.repro.test.ts` | PASS |
| Failed recording remains non-blocking and observable | `src/application/recording/board-event-recorder.ts:53` | IN PROGRESS |
| Board labels health and sample size beside rates and medians | `src/interfaces/tui/flow-panel.tsx:52` | IN PROGRESS |
| Required final verification passes | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` | PENDING |

Next action: add the recorder-failure counter assertion in `test/board-event-recorder.test.ts`.
