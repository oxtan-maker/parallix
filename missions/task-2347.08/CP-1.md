# CP-1 — Reproduction locked

Added `test/task-2347.08-own-statistics-semantics-repro.test.ts`. Its two-row
fixture uses one repository and two case variants of the same mission identity;
both rows are closed and in the same reporting window. The CLI report path
deduplicates it while the board adapter currently produces two outcomes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: CLI and board use one result for the fixture | `test/task-2347.08-own-statistics-semantics-repro.test.ts:38`; `"task-2347.08 repro: CLI and board agree on identity, completions, and cycle time"` | Red at parent: CLI count 1, board count 2 |
| SC6: regression is red before the shared service | `npm test -- test/task-2347.08-own-statistics-semantics-repro.test.ts`; `test/task-2347.08-own-statistics-semantics-repro.test.ts:49` | Confirmed red before implementation |

Next action: Extract the application statistics service and migrate the fixture's identity, completion, window, and cycle-time semantics to it.
