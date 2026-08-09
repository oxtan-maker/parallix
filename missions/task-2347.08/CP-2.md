# CP-2 — Shared semantics extracted

Added `src/application/services/statistics-service.ts` and
`test/statistics-service.test.ts`. The service owns the canonical repository +
mission key, exact completion marker, UTC reporting-window membership, and UTC
hour conversion used by subsequent adapters.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: identity, completion, and window semantics have one service definition | `src/application/services/statistics-service.ts:25`; `src/application/services/statistics-service.ts:30`; `src/application/services/statistics-service.ts:35` | Passed by focused service test |
| SC3: equivalent offset instants share a UTC bucket | `src/application/services/statistics-service.ts:58`; `"statistics service buckets equivalent offsets in the same UTC hour"` | Passed |
| SC4: service provides ordered evaluation inputs | `src/application/services/statistics-service.ts:66`; `test/statistics-service.test.ts` | Prepared for adapter migration |

Next action: Route CLI and board adapters through the service and replace the board-metrics positional API.
