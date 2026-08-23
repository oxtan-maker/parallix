# CP-2: SQLite projection query guards

Added a counting database seam scoped to the review projection reader. One mission and a populated mission set each execute exactly four queries, while the SQLite-backed adapter never calls the aggregate store.

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

Next action: implement shared review hydration and the four-relation reader in CP-3.
