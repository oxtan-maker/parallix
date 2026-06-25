# CP-1

Implemented `detectRebaseState()` in `lib/core/git.js` to detect active rebase metadata, detached HEAD state, the current rebase commit, and unresolved index entries from `git ls-files -u`. Added focused regression coverage for active, clean, and completed rebase states in `test/git.test.js`.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| `detectRebaseState()` returns structured active-rebase diagnostics including detached HEAD, current rebase commit, unmerged files, and rebase directory | [lib/core/git.js](/home/magnus/code/parallix-task-1328/lib/core/git.js:64) |
| Active rebase case is covered with three mission-local conflicted paths and detached HEAD assertions | Test `detectRebaseState reports active rebase with detached head and unmerged files` in [test/git.test.js](/home/magnus/code/parallix-task-1328/test/git.test.js:75) |
| Clean worktree case returns `{ inProgress: false }` with no rebase metadata | Test `detectRebaseState reports false for a clean worktree with no rebase activity` in [test/git.test.js](/home/magnus/code/parallix-task-1328/test/git.test.js:127) |
| Completed rebase case returns non-in-progress state after metadata removal and branch reattachment | Test `detectRebaseState reports false once rebase metadata is gone and head is attached` in [test/git.test.js](/home/magnus/code/parallix-task-1328/test/git.test.js:157) |
| CP-1 verification passed | Test run `node --test test/git.test.js` |

Next action: extend `px status` to surface `detectRebaseState()` output for both the current worktree and stale mission worktrees, then capture CP-2 evidence.
