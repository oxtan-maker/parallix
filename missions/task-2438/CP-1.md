# CP-1: Lock the sibling-worktree omission

Updated the TASK-2438 fixture so `task-2438-active` exists in the persisted
repository store and only in the other worktree's Markdown catalog. The
launching worktree's board omits it on the parent implementation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Persisted active mission is absent from the launching worktree catalog | `test/task-2438-worktree-board-repro.test.ts`, `task-2438 board reads persisted repository missions from every worktree` | PASS |
| Parent implementation reproduces the omission | `./node_modules/.bin/tsx --test test/task-2438-worktree-board-repro.test.ts` reports `task-2438-active` missing from the projection | PASS (red) |
| Foreign repository stays outside the store read | `test/task-2438-worktree-board-repro.test.ts`, `task-2438 mission store scopes board reads to the repository` | PASS |

Next action: merge current persisted repository missions into the shared board
catalog while retaining the existing archived-record exclusion.
