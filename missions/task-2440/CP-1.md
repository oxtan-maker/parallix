# CP-1: External lifecycle reproduction

## Summary

Added a temporary-repository regression that persists two Missions, performs an external Backlog lifecycle write for one task, and reads the repository-scoped board.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| External write is followed by a board read | `test/task-2440-repro.test.ts`, `node --import tsx --test test/task-2440-repro.test.ts` | RED: board card remains `backlog` after the write |
| Unrelated Mission is in the scenario | `test/task-2440-repro.test.ts` | PASS: sibling is seeded and asserted as `review` |
| Reproduction uses local-only dependencies | `test/task-2440-repro.test.ts` | PASS: temporary Git repository and SQLite state only |

Next action: reconcile `transitionTask`'s successful external status update into the matching SQLite Mission aggregate.
