# CP-2: Reconcile the external lifecycle seam

## Summary

`transitionTask` now reconciles a successful changed Backlog lifecycle status into an existing SQLite Mission only when its repository identity matches. SQLite failures and absent or closed Missions remain no-ops, preserving the external write result.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| External lifecycle write updates the matching persisted Mission | `src/adapters/backlog/task-transitions.ts`, `test/task-2440-repro.test.ts` | PASS |
| Reconciliation remains repository-scoped and does not create a Mission | `src/adapters/backlog/task-transitions.ts` | PASS |
| Existing external write success result remains intact | `test/task-2440-repro.test.ts` | PASS |
| Focused regression passes | `node --import tsx --test test/task-2440-repro.test.ts` | PASS |

Next action: run the required repository gate and record final regression evidence.
