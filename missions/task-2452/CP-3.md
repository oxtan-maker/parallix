# CP-3 — Both surfaces consume the shared total

The Ink shell, web snapshot DTO, validator, and web top bar now consume `inFlightWip`. Removed the browser `WIP_LANES` calculation and its guard exception. Added wire round-trip and fail-closed rejection coverage.

Exact green reproduction run:

```text
✔ TUI and web top bars share the in-flight WIP total
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 authoritative projection total | `test/board-projections.test.ts`, `'buildBoardProjection inFlightWip counts refined, active, review and integration lanes only'` | PASS |
| SC2 approved integration counts in flight | `test/board-projections.test.ts`, `'buildBoardProjection inFlightWip counts refined, active, review and integration lanes only'` | PASS |
| SC3 TUI renders in-flight WIP | `test/task-2452-repro.test.ts`, `npm test -- test/task-2452-repro.test.ts` | PASS |
| SC4 web consumes shared projected total and guard is restored | `test/web-board-render.test.ts`, `'the top bar WIP counts only in-flight lanes, not backlog or done'`, `'production browser code maps no lane to a lifecycle rule or command'` | PASS |
| SC5 both surfaces render the same total | `test/task-2452-repro.test.ts`, `'TUI and web top bars share the in-flight WIP total'` | PASS |
| SC6 wire rejects missing and non-finite total | `test/web-transport.test.ts`, `'snapshot carries inFlightWip and rejects missing or non-finite values'` | PASS |
| SC7 green reproduction recorded | `npm test -- test/task-2452-repro.test.ts`, `test/task-2452-repro.test.ts` | PASS |
| SC8 final verification gate | `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: run the full verification gate and confirm the production membership rule has one home.
