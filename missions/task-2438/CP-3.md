# CP-3: Manual review correction

The board now combines the non-archived Markdown task catalog with persisted
missions. Markdown-only open tasks remain selectable, while a persisted mission
supplies its lifecycle state. This keeps the board repository-scoped without
making a worktree's task copy a competing lifecycle authority.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Unstarted backlog task remains on the board | `test/task-2438-worktree-board-repro.test.ts`, `task-2438 board reads persisted repository missions from every worktree` | PASS |
| Persisted lifecycle state wins for a shared task | `test/task-2438-worktree-board-repro.test.ts`, `task-2438 board reads persisted repository missions from every worktree` | PASS |
| Archived task is absent | `test/task-2438-worktree-board-repro.test.ts`, `task-2438 board reads persisted repository missions from every worktree` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |
| Documentation validation passes | `./scripts/verify-local.sh docs` | PASS |

Known limitation: [task-2440](../../backlog/tasks/task-2440%20-%20Reconcile-external-Backlog-lifecycle-updates-into-SQLite.md)
tracks lifecycle rows made stale by external Backlog writes; SQLite remains the
lifecycle authority until that write-path reconciliation lands.
