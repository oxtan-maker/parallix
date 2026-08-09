# CP 2 — Closed outcome contract

`MissionOutcome` now carries creation and closure timestamps. The metrics read
adapter returns only repository-scoped missions with a dated `closed: 'yes'`
record, derives creation from the earliest dated telemetry, and maps closure
from the dated closed record. The existing board
metrics test suite remains runnable with the expanded contract.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: MissionOutcome declares createdAt and closedAt | `src/domain/usage.ts:99` | PASS |
| SC2: adapter maps timestamps and excludes non-closed records | `src/application/projections/metrics-read-adapter.ts:115` | PASS |
| Existing board metric tests compile and run | `test/board-metrics.test.ts`; `node --import tsx --test test/board-metrics.test.ts` | PASS |
| SC11 reproduction excludes active and review telemetry | `"throughput excludes active and review telemetry, and weekly buckets use closure week"` | PARTIAL — bucket assertion remains red |

Next action: Replace lifetime-count metric implementations with closedAt-scoped series and ISO-week throughput buckets.
