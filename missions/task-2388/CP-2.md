# CP-2: Repository-scoped recovery + nested worktree CWD (task-2388)

## Summary
Updated `src/adapters/agents/running-sessions.ts` so the fallback recovery path
trusts only sessions proven to belong to the current repository.

- Explicit-slug candidates are now accepted only when the process runs inside
  the board repository's working set (board root or a listed mission worktree),
  via new `runsInsideBoardRepo`. A same-named `px` launched from another
  checkout is ignored (SC1 / AC #1); it is never fabricated as local (SC3).
- `resolveWorktree` now matches the working directory on a path boundary, so a
  slug-less command started in a directory nested under a worktree resolves to
  that worktree (SC2 / AC #2). The longest matching worktree wins so siblings
  that share a name prefix stay distinct.
- Conservative unknown/ignore behaviour preserved: slug-less + unavailable
  worktree listing still returns `null`; unattributable candidates are ignored.

`isContainedIn` enforces directory-boundary containment (`target === root` or
`target.startsWith(root + '/')`), closing the sibling-prefix risk.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 explicit slug repo-scoped | `test/task-2388-repro.test.ts` "SC1: an explicit-slug process outside the board repository is not reported as local"; `test/running-sessions.test.ts` "detectRunningMissionSessions ignores an explicit slug from a different repository" | PASS |
| SC2 nested worktree CWD | `test/task-2388-repro.test.ts` "SC2: a slug-less command from a nested directory under a worktree resolves to that mission"; `test/running-sessions.test.ts` "detectRunningMissionSessions resolves a slug-less command from a nested worktree CWD" | PASS |
| SC3 no fabricated session / unknown preserved | `test/running-sessions.test.ts` "detectRunningMissionSessions reports unknown when a slug-less session cannot be placed" | PASS |
| Existing detection unchanged | `node --test test/running-sessions.test.ts` → 17 pass | PASS |

## Next action
Implement CP-3: add `liveSession` and `unattributedRunningSessions` to
`boardFingerprint`, add the subscription repaint test, verify, and commit.
