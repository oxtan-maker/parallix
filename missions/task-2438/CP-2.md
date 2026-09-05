# CP-2: Merge persisted sibling-worktree missions

The shared board catalog now starts with current Markdown tasks, overlays their
persisted lifecycle aggregates, and adds persisted repository missions missing
from this worktree. Before adding a missing persisted ID, it reuses the task
resolver to exclude a locally archived record.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Persisted active mission from the other worktree is included | `test/task-2438-worktree-board-repro.test.ts`, `task-2438 board reads persisted repository missions from every worktree` | PASS |
| Persisted lifecycle lanes override Markdown task states | `test/task-2438-worktree-board-repro.test.ts`, `task-2438 board reads persisted repository missions from every worktree` | PASS |
| Archived persisted record remains excluded | `test/task-2438-worktree-board-repro.test.ts`, `task-2438 board reads persisted repository missions from every worktree` | PASS |
| Static analysis is clean | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: confirm the green shared projection evidence is sufficient for the
existing CP-3 handoff, then run the mission-wide verifier for CP-4.
