# CP-1: Draft complete — feature-branch draft stats use worktree rootDir

## Summary

The mission goal is for `recordDraftStats` to resolve the backlog task from the
mission worktree (`targetWorktree`) rather than `mainRepo`, so draft-stage
telemetry is recorded for feature-branch missions.

On verifying the current tree I found the required fix is already present and
correct on this branch (it landed in `main` via commit `ef2149cd` —
"Record draft stats from the mission worktree (fix TASK-1352)"). The branch
`mission/task-1352` carries no code delta vs `main` (`git diff main --stat`
shows only the backlog task file and `MISSION.md`). Rather than re-implement an
identical change, I validated every Success Criterion and Gate against the
existing code and confirmed all pass.

Concretely:

- The call site injects `recordDraftStatsFn` (default `recordDraftStats`) at
  `lib/commands/draft.js:117` and invokes it with `rootDir: targetWorktree` at
  `lib/commands/draft.js:312-319`, matching how `resolveTaskFileFn`,
  `recordDraftImplementerFn`, and `enforceDraftCommitSafetyFn` already receive
  the worktree.
- The regression test captures `opts.rootDir` (`test/draft-command.test.js:63`)
  and asserts the stats call uses `worktree`, not `mainRepo`
  (`test/draft-command.test.js:86-88`).
- `lib/commands/stats.js` is untouched (no signature/API changes).

No code edits were necessary; the scope contract (one call-site + one test
assertion) is satisfied by the existing tree.

## Goal Check

| # | Success Criterion | Evidence | Status |
|---|---|---|---|
| 1 | `draft.js` passes `rootDir: targetWorktree` (not `mainRepo`) to `recordDraftStatsFn` | `lib/commands/draft.js:314` (`rootDir: targetWorktree`) within the `recordDraftStatsFn({...})` call at `lib/commands/draft.js:312-319` | PASS |
| 2 | `draft-command.test.js` asserts `recordDraftStatsFn` called with `opts.rootDir` equal to worktree | `test/draft-command.test.js:63` captures `opts.rootDir`; `test/draft-command.test.js:88` asserts `['stats', 'task-1038', worktree]` | PASS |
| 3 | `npm test` passes with no regressions | `npm test` → `tests 1689 / pass 1667 / fail 0 / skipped 22`; test `runDraftCommand top-level flows are covered with injected dependencies` (`test/draft-command.test.js:11`) green via `node --test` → `pass 3 / fail 0` | PASS |
| 4 | No changes to `lib/commands/stats.js` definitions/exported APIs | `git diff main --stat` shows only `backlog/tasks/task-1352 …md` and `missions/task-1352/MISSION.md` changed; `lib/commands/stats.js` not in diff | PASS |
| Gate | `./scripts/verify-local.sh docs` | `PASS: all required documentation present` (EXIT=0) | PASS |

## Next action

Commit `missions/task-1352/MISSION.md` and `missions/task-1352/CP-1.md`, then
hand off task-1352 to review — all Success Criteria and the `docs` gate pass
with no code change required (fix already present at `lib/commands/draft.js:314`).
