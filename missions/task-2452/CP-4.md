# CP-4 — Final verification

Ran the mission verification gate after the final fixture reuse cleanup. The authoritative membership literal is present only in `src/application/projections/board.ts`; test fixtures import that production rule rather than recreating it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 authoritative projection total and one production rule | `src/application/projections/board.ts`, `test/board-projections.test.ts`, `'buildBoardProjection inFlightWip counts refined, active, review and integration lanes only'` | PASS |
| SC2 approved integration counts in flight | `test/board-projections.test.ts`, `'buildBoardProjection inFlightWip counts refined, active, review and integration lanes only'` | PASS |
| SC3 TUI renders in-flight WIP without altering lane headers | `test/task-2452-repro.test.ts`, `test/tui-lane-columns.test.ts`, `'renders lane header with WIP count from the projection'` | PASS |
| SC4 web consumes shared total and guard is strict | `test/web-board-render.test.ts`, `'the top bar WIP counts only in-flight lanes, not backlog or done'`, `'production browser code maps no lane to a lifecycle rule or command'` | PASS |
| SC5 both surfaces render the same total | `test/task-2452-repro.test.ts`, `'TUI and web top bars share the in-flight WIP total'` | PASS |
| SC6 wire round-trip and fail-closed validation | `test/web-transport.test.ts`, `'snapshot carries inFlightWip and rejects missing or non-finite values'` | PASS |
| SC7 red-to-green reproduction | `test/task-2452-repro.test.ts`, `npm test -- test/task-2452-repro.test.ts` | PASS |
| SC8 verification gate | `./scripts/verify-local.sh all` | PASS |

Next action: hand the committed mission branch to Parallix for its lifecycle transition.
