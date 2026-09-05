# CP-2 — Projection owns the in-flight rule

Added `IN_FLIGHT_WIP_LANES` and `BoardProjection.inFlightWip` in the shared board projection. Updated complete projection fixtures and pinned an approved raw-status card in `integration`; the surface reproduction remains deliberately red because neither consumer reads the new field yet.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 authoritative projection total | `test/board-projections.test.ts`, `'buildBoardProjection inFlightWip counts refined, active, review and integration lanes only'` | PASS |
| SC2 approved integration counts in flight | `test/board-projections.test.ts`, `'buildBoardProjection inFlightWip counts refined, active, review and integration lanes only'` | PASS |
| SC3 TUI renders in-flight WIP | `test/task-2452-repro.test.ts`, `npm test -- test/board-projections.test.ts test/task-2452-repro.test.ts` | RED: TUI still renders 8 |
| SC4 web consumes shared projected total and guard is restored | `test/web-board-render.test.ts`, `'production browser code maps no lane to a lifecycle rule or command'` | PENDING CP-3 |
| SC5 both surfaces render the same total | `test/task-2452-repro.test.ts`, `'TUI and web top bars share the in-flight WIP total'` | PENDING CP-3 |
| SC6 wire rejects missing and non-finite total | `test/web-transport.test.ts` | PENDING CP-3 |
| SC7 red reproduction remains pinned | `npm test -- test/task-2452-repro.test.ts`, `test/task-2452-repro.test.ts` | PASS |
| SC8 final verification gate | `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: carry `inFlightWip` over the web boundary and replace both top-bar local calculations.
