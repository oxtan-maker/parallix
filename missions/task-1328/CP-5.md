# CP-5

Added a TASK-1322-focused regression in `test/rebase_diagnostics.test.js` that drives the detached-head, `.git/rebase-merge`, and mission-local conflict state through all three operator surfaces: `px status`, `px rebase`, and `px integrate --dry-run`. The test asserts the exact conflicted paths and the command-specific recovery guidance instead of generic dirty-worktree messaging.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| The regression fixture models the TASK-1322 rebase state with detached HEAD, `.git/rebase-merge`, and the three mission-local conflicted files | [test/rebase_diagnostics.test.js](/home/magnus/code/parallix-task-1328/test/rebase_diagnostics.test.js:7) |
| `px status` coverage in the regression asserts detached-head rebase output and all conflicted paths | [test/rebase_diagnostics.test.js](/home/magnus/code/parallix-task-1328/test/rebase_diagnostics.test.js:100) |
| `px rebase` coverage in the regression asserts exit 1, no fresh rebase attempt, current rebase head reporting, and recovery commands | [test/rebase_diagnostics.test.js](/home/magnus/code/parallix-task-1328/test/rebase_diagnostics.test.js:136) |
| `px integrate --dry-run` coverage in the regression asserts the `rebase-in-progress` failure and checkout recovery guidance | [test/rebase_diagnostics.test.js](/home/magnus/code/parallix-task-1328/test/rebase_diagnostics.test.js:171) |
| CP-5 verification passed | Test run `node --test test/rebase_diagnostics.test.js` |

Next action: run the full mission gates (`npm test`, `./scripts/verify-local.sh docs`), update the backlog task notes if needed, refresh the graph with `graphify update .`, then write the final checkpoint with gate evidence.
