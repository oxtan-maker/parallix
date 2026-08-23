# CP-1: Batch board characterization

Added the board regression that covers no-review, active review, changes with a response, and approved pull-request cards through one batch read. It also proves integration remains tied to approval of the displayed revision.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 board semantics | `test/board-readers.test.ts`, `BoardProjectionBuilder preserves populated multi-round review cards from a batch projection` | PASS |
| SC2 reviewed revision | `test/board-readers.test.ts`, `BoardProjectionBuilder preserves populated multi-round review cards from a batch projection` | PASS |
| SC3 bounded queries | `test/task-2401-review-projection-queries.test.ts`, `SQLite review projection uses four queries for one or many missions`, `npm test -- test/task-2401-review-projection-queries.test.ts` | PASS |
| SC4 no aggregate board reads | `test/task-2401-review-projection-queries.test.ts`, `SQLite-backed board review projection never loads Mission aggregates` | PASS |
| SC5 aggregate authority retained | `src/adapters/sqlite/mission-store.ts`, `git diff --check` | PASS |
| SC6 fallback retained | `test/adapters/concrete-adapters-cp2.test.ts`, `ConcreteReviewReadAdapter batch fallback preserves flat and missing review state` | PASS |
| SC7 final gate | `./scripts/verify-local.sh all` | PASS |

Next action: verify the SQLite query-count and aggregate-load seams in CP-2.
