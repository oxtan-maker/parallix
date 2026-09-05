# CP-1 — Red reproduction and bug label

Added the permanent cross-surface reproduction in `test/task-2452-repro.test.ts` before production changes. It builds the prescribed eight-card board, including an approved mission in `integration`; the backlog already records the required `user_value` label.

Exact red run from the parent behavior:

```text
✖ TUI and web top bars share the in-flight WIP total
  AssertionError [ERR_ASSERTION]: the eight-card board has four in-flight missions

  8 !== 4
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 authoritative projection total | `test/board-projections.test.ts` | PENDING CP-2 |
| SC2 approved integration counts in flight | `test/board-projections.test.ts` | PENDING CP-2 |
| SC3 TUI renders in-flight WIP | `test/task-2452-repro.test.ts`, `npm test -- test/task-2452-repro.test.ts` | RED: renders 8 |
| SC4 web consumes shared projected total and guard is restored | `test/web-board-render.test.ts`, `'production browser code maps no lane to a lifecycle rule or command'` | PENDING CP-3 |
| SC5 both surfaces render the same total | `test/task-2452-repro.test.ts`, `'TUI and web top bars share the in-flight WIP total'` | PENDING CP-3 |
| SC6 wire rejects missing and non-finite total | `test/web-transport.test.ts` | PENDING CP-3 |
| SC7 red reproduction recorded | `npm test -- test/task-2452-repro.test.ts`, `test/task-2452-repro.test.ts` | PASS |
| SC8 final verification gate | `./scripts/verify-local.sh all` | PENDING CP-4 |

Next action: add the single projection-owned membership rule and pin its lane semantics in projection tests.
