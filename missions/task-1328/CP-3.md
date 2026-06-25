# CP-3

Added a pre-flight rebase-state guard to `px rebase` that runs before branch validation and before any fresh `git rebase` invocation. When a mission worktree is already mid-rebase, the command now exits with explicit diagnostics: the current rebase head, the exact conflicted paths, and the operator recovery commands (`--continue`, `--abort`, `--skip`).

## Goal Check Table

| Check | Evidence |
| --- | --- |
| `px rebase` now checks for an existing in-progress rebase before normal branch validation or a new rebase attempt | [lib/commands/rebase.js](/home/magnus/code/parallix-task-1328/lib/commands/rebase.js:51) |
| The pre-flight guard prints current rebase head, conflicted files, and all three recovery commands before exiting 1 | [lib/commands/rebase.js](/home/magnus/code/parallix-task-1328/lib/commands/rebase.js:53) |
| Regression coverage verifies the guard exits 1, reports mission-local conflict paths, and does not call a fresh `git rebase main` | Test `rebase exits 1 with recovery guidance when a rebase is already in progress` in [test/rebase.test.js](/home/magnus/code/parallix-task-1328/test/rebase.test.js:113) |
| CP-3 verification passed | Test run `node --test test/rebase.test.js` |

Next action: wire the same helper into `px integrate --dry-run` preflight so dry-run fails fast with a dedicated `rebase-in-progress` blocker and recovery instructions, then capture CP-4.
