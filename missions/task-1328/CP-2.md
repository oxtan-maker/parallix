# CP-2

Extended `px status` to call `detectRebaseState()` for the current worktree and for stale mission worktrees, emitting explicit rebase-in-progress diagnostics with conflicted file lists instead of only generic uncommitted-file or cleanup output. The stale-worktree payload now preserves the branch ref so the status output can identify which mission branch is mid-rebase.

## Goal Check Table

| Check | Evidence |
| --- | --- |
| `px status` now logs detached-head rebase diagnostics for the current worktree when an in-progress rebase is detected | [lib/commands/status.js](/home/magnus/code/parallix-task-1328/lib/commands/status.js:130) |
| Stale mission worktree diagnostics now include branch context and rebase-state output without changing stale-worktree selection rules | [lib/commands/status.js](/home/magnus/code/parallix-task-1328/lib/commands/status.js:77), [lib/commands/status.js](/home/magnus/code/parallix-task-1328/lib/commands/status.js:169) |
| Current-worktree detached HEAD reporting is covered with the three TASK-1322 conflict paths | Test `status reports detached-head rebase diagnostics for the current worktree` in [test/status.test.js](/home/magnus/code/parallix-task-1328/test/status.test.js:229) |
| Stale-worktree reporting is covered with branch-qualified `Rebase in progress on mission/task-1322` output | Test `status reports stale worktree rebase diagnostics instead of only cleanup hints` in [test/status.test.js](/home/magnus/code/parallix-task-1328/test/status.test.js:268) |
| CP-2 verification passed | Test run `node --test test/status.test.js` |

Next action: add the pre-flight `px rebase` guard that blocks a fresh rebase when mission-local rebase metadata or unmerged index entries already exist, then capture CP-3.
