# CP-4: Verification gates and final Goal Check (task-2388)

## Summary
Ran the focused regression suite and both required repository gates on the final
tree. All pass.

- `npx tsx --test test/task-2388-repro.test.ts test/running-sessions.test.ts test/task-2373-refresh-performance.test.ts` → 26 pass (the `node --test`
  form cannot resolve the TypeScript source's `.js` imports, so `npx tsx --test`
  is the runnable command).
- SC5 red-to-green with that command: 4 fail against the base branch
  `friday-08-21` code, 5 pass after the fix — repro red at `test/task-2388-repro.test.ts`, green post-fix.
- `./scripts/verify-local.sh static-analysis` → all 4 stages pass (ESLint,
  `npm run typecheck`, test-hygiene, test typecheck).
- `./scripts/verify-local.sh all` → EXIT 0, 1966 tests pass, 0 fail.

Production changes: `src/adapters/agents/running-sessions.ts` (explicit-slug
repo scoping via `runsInsideBoardRepo`, boundary-aware nested-CWD resolution in
`resolveWorktree`, conservative unknown/ignore preserved) and
`src/application/projections/board-subscription.ts` (`boardFingerprint` now
includes per-card `liveSession` and `metrics.unattributedRunningSessions`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 explicit slug scoped to board repository | `test/task-2388-repro.test.ts` "SC1: an explicit-slug process outside the board repository is not reported as local"; `test/running-sessions.test.ts` "detectRunningMissionSessions ignores an explicit slug from a different repository" | PASS |
| SC2 nested worktree CWD resolves | `test/task-2388-repro.test.ts` "SC2: a slug-less command from a nested directory under a worktree resolves to that mission"; `test/running-sessions.test.ts` "detectRunningMissionSessions resolves a slug-less command from a nested worktree CWD" | PASS |
| SC3 conservative unknown/ignore, no fabrication | `test/running-sessions.test.ts` "detectRunningMissionSessions reports unknown when a slug-less session cannot be placed"; `test/running-sessions.test.ts` "detectRunningMissionSessions reports unknown when the process table cannot be read" | PASS |
| SC4 fingerprint moves on liveSession + unattributed | `test/task-2388-repro.test.ts` "SC4: a liveSession change repaints the board" / "SC4: an unattributedRunningSessions change repaints the board"; `test/task-2373-refresh-performance.test.ts` "SC6: a recovery-only state change (unattributed running sessions) repaints the board" | PASS |
| SC5 repro red at parent, green after | `npx tsx --test test/task-2388-repro.test.ts` 4 fail @ `friday-08-21` → 5 pass after fix | PASS |
| SC6 focused detector + subscription coverage | `test/running-sessions.test.ts` (2 new), `test/task-2373-refresh-performance.test.ts` (1 new) | PASS |
| SC7 verification gates pass | `./scripts/verify-local.sh static-analysis` (4/4 stages); `./scripts/verify-local.sh all` → 1966 pass, 0 fail | PASS |

## Next action
Commit CP-4.md and the backlog note; confirm no uncommitted mission or
checkpoint files. Mission complete.
