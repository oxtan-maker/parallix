# Mission: Detect in-progress mission rebases in px status, px rebase, and px integrate diagnostics (task-1328)

## Goal

Add rebase-in-progress detection to `px status`, `px rebase`, and `px integrate --dry-run` so that operators seeing a broken mission worktree (detached HEAD, active rebase metadata dirs, unmerged index entries) get explicit diagnostic output identifying the rebase-in-progress state with exact conflicted paths and actionable recovery commands, instead of generic "local changes" errors.

## Why Now

TASK-1322 integration recovery exposed the gap: `px integrate task-1322 --dry-run` correctly flagged a merge-conflict blocker, but the operator's follow-up flow was misleading — `px status` collapsed the state to a single uncommitted file count, `px rebase` surfaced git's generic "you have local changes" error, and the worktree was actually on detached HEAD mid-interactive rebase with unresolved mission-local metadata conflicts (`backlog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md`, `missions/task-1322/review-state.json`, `missions/task-1322/CP-4.md`). Operators had to infer the real state from raw git output. This fix eliminates that inference burden.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: Operator experience degradation during recovery; existing rebase conflict classification code already handles post-rebase conflicts but has no pre-flight guard.

## Scope

- `lib/core/git.js`: Add `detectRebaseState(cwd)` helper that checks for `.git/rebase-merge` / `.git/rebase-apply` directories, runs `git rebase --show-current`, detects detached HEAD via `git rev-parse --verify HEAD`, inspects `ls-files -u` for unmerged entries, and returns a structured object with `inProgress`, `rebaseHead`, `detached`, `unmergedFiles[]`, and `rebaseDir` fields.
- `lib/commands/status.js`: Import `detectRebaseState`; for each mission worktree listed by `findStaleMissionWorktrees`, call `detectRebaseState(worktreePath)` and if `inProgress`, emit `Rebase in progress on <branch>: detached HEAD, <N> unmerged file(s)` followed by the file list. In the primary worktree section, if detached HEAD is detected, report `Detached HEAD: rebase in progress` with the same file list. Do not change the existing stale-worktree detection logic.
- `lib/commands/rebase.js`: At the top of the `rebase()` function, after slug resolution and before the branch check, call `detectRebaseState(process.cwd())`. If `inProgress`, print the exact unmerged file paths, the current rebase head commit, and recovery commands (`git rebase --continue`, `git rebase --abort`, `git rebase --skip`) and exit with code 1. Do not call `git rebase` at all in this path. Preserve all existing conflict classification and auto-resolution logic for the normal path.
- `lib/commands/integrate.js`: In `printIntegrationPreflight()`, add a rebase-in-progress check for the base worktree using `detectRebaseState(baseWorktree)`. If `inProgress`, emit a FAIL-level preflight message listing the unmerged files and recovery commands, and add `'rebase-in-progress'` to the failures array so that dry-run aborts before attempting the dry merge.
- `test/rebase_diagnostics.test.js`: Add a regression test that simulates the TASK-1322 recovery state (detached HEAD, `.git/rebase-merge` dir with refs, unmerged index entries for three mission-local files) and verifies that `px status`, `px rebase`, and `px integrate --dry-run` each report the rebase-in-progress state with accurate file paths.

## Out of Scope

- Fixing or resolving the actual rebase conflicts (that is the operator's job).
- Changes to the rebase conflict classification logic in `lib/commands/rebase.js` (already handles post-rebase conflicts correctly).
- Changes to `px integrate` non-dry-run path behavior beyond the preflight abort.
- Adding new CLI flags or subcommands.
- Changes to the Forgejo/PR sync path.
- Changes to the agent conflict-resolution prompt or launch flow.

## Success Criteria

1. `detectRebaseState(dir)` returns `{ inProgress: true, detached: true, unmergedFiles: ['file1', 'file2', 'file3'], rebaseDir: '.git/rebase-merge' }` when called inside a worktree with an active rebase (`.git/rebase-merge` exists, HEAD is detached, `ls-files -u` lists entries).
2. `detectRebaseState(dir)` returns `{ inProgress: false }` when called in a clean worktree with no rebase activity.
3. `detectRebaseState(dir)` returns `{ inProgress: false }` when called in a worktree where a rebase completed cleanly (`.git/rebase-merge` removed, HEAD attached to branch).
4. `px status` invoked from a detached HEAD mission worktree with an active rebase prints a line matching `Rebase in progress` and lists all unmerged file paths from `ls-files -u`.
5. `px rebase <slug>` invoked from a worktree with an active rebase prints the unmerged file paths, the rebase head, and exits with code 1 without calling `git rebase`.
6. `px integrate <slug> --dry-run` invoked from a worktree with an active rebase fails preflight with `'rebase-in-progress'` in the failures list and does not reach the dry merge step.
7. A regression test in `test/rebase_diagnostics.test.js` creates a mock worktree state with `.git/rebase-merge`, detached HEAD, and unmerged entries, and asserts that all three commands produce the expected diagnostic output.
8. `npm test` passes with zero failures after all changes.

## Risks and Assumptions

- Assumption: `.git/rebase-merge` and `.git/rebase-apply` are the only rebase state directories git uses. This is true for git 2.x.
- Risk: The `detectRebaseState` helper adds ~5 git invocations per worktree check. Impact is negligible for status/rebase/integrate which are interactive commands, not hot paths.
- Risk: `px status` currently iterates over worktrees via `git worktree list --porcelain`. If a worktree is being cleaned up concurrently, `detectRebaseState` could fail on a removed path. We guard with try/catch and skip silently.
- Assumption: Unmerged index entries (`ls-files -u`) are the authoritative source of conflicted file paths, more reliable than parsing rebase output text.
- Risk: The `px rebase` pre-check changes exit semantics — if an operator accidentally runs `px rebase` mid-rebase, they get exit 1 instead of the generic git error. This is the intended improvement.

## Checkpoints

- CP 1: `detectRebaseState()` implemented in `lib/core/git.js` with unit tests covering active rebase, clean worktree, and completed rebase states.
- CP 2: `px status` updated to emit rebase-in-progress diagnostics for worktrees and primary worktree.
- CP 3: `px rebase` updated with pre-flight rebase-in-progress guard.
- CP 4: `px integrate --dry-run` preflight updated to fail on rebase-in-progress state.
- CP 5: Regression test added to `test/rebase_diagnostics.test.js` covering the TASK-1322 scenario.
- CP 6: `npm test` passes; all existing tests unchanged.

## Gates

- [ ] `npm test` — all tests pass
- [ ] `./scripts/verify-local.sh docs` — documentation gate passes

## Restricted Areas

- Do not modify `lib/commands/review.js`, `lib/review/review-loop.js`, `lib/review/review-adapter.js`, or any agent telemetry files.
- Do not modify the conflict classification logic in `lib/commands/rebase.js` beyond the pre-flight guard insertion.
- Do not change the `findStaleMissionWorktrees` function in `lib/commands/status.js` — only extend its output.
- Do not touch `lib/tools/forgejo.js` or any Forgejo sync code.

## Stop Rules

- Stop if `npm test` reveals that `detectRebaseState` breaks any existing test in `test/rebase.test.js`, `test/status.test.js`, or `test/integrate.test.js`. Investigate and fix before proceeding.
- Stop if the rebase-in-progress detection interferes with the existing `rebase --show-current` checks already present in `lib/commands/rebase.js` (lines 99-110). The pre-flight guard must run before those checks, not duplicate them.
- Stop if adding the pre-flight guard to `px rebase` causes the function to skip the `getCurrentBranch` validation, which would allow running `px rebase` from the wrong branch. The guard must run before the branch check, not replace it.
