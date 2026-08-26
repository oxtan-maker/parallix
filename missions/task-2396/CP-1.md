# Checkpoint 1 — Failing regression test for stale base-branch on primary re-draft

## Work done

Added a red-to-green regression to `test/draft.test.ts` (task-2396) that
reproduces the task-2389 breakage without touching any implementation:

- `runDraftCommand clears a stale feature Base-Branch when re-drafted from the primary branch`
  seeds an existing mission whose `MISSION.md` carries `Base-Branch: friday-08-21`,
  runs `px draft` with `detectLaunchBaseBranchFn` returning `null` (a primary /
  `main` launch), then asserts the resolved base is `main`. It drives the real
  draft-startup base writer (`ensureMissionBaseBranchRecorded`) and the real
  `resolveMissionBaseBranch` against a real temp git repo on `main`; only the
  heavy external steps (branch/worktree/agent/SQLite) are stubbed.
- `runDraftCommand records a non-primary launch branch over a previous base on re-draft`
  seeds the same stale `Base-Branch: friday-08-21` and re-drafts from a feature
  branch (`detectLaunchBaseBranchFn: () => 'feature/two'`), asserting the new
  launch branch replaces the old value. This is the CP-3 focused-coverage case.

Both live in `test/draft.test.ts` next to the existing `ensureMissionBaseBranchRecorded`
unit tests.

## Red result at the mission parent commit (`32adb4f89`)

Command: `npx tsx test/run-default-tests.ts test/draft.test.ts` (via
`test/run-default-tests.ts`; node 22 with `--experimental-test-module-mocks`).

- ✖ `runDraftCommand clears a stale feature Base-Branch when re-drafted from the primary branch`
  fails with `AssertionError [ERR_ASSERTION]: stale Base-Branch line must be removed
  on primary re-draft` (`actual: false`) — the writer is a no-op for primary
  launches, so `Base-Branch: friday-08-21` survives and `resolveMissionBaseBranch`
  would resolve the dead branch.
- ✔ `runDraftCommand records a non-primary launch branch over a previous base on re-draft`
  is green (existing in-place replace already works).

Green (post-fix) for both will be recorded in CP-2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression seeds existing mission with `Base-Branch: friday-08-21` and runs draft from `main` | `test/draft.test.ts`, `"runDraftCommand clears a stale feature Base-Branch when re-drafted from the primary branch"` | PASS |
| Regression is RED at the parent commit because stale branch resolution survives | `test/draft.test.ts`, `AssertionError: stale Base-Branch line must be removed on primary re-draft` (actual `false`) | PASS (red reproduced) |
| Non-primary re-draft coverage present | `test/draft.test.ts`, `"runDraftCommand records a non-primary launch branch over a previous base on re-draft"` | PASS |

Next action: Trace every caller of the draft-startup base writer (`ensureMissionBaseBranchRecorded`) and resolver (`resolveMissionBaseBranch`), then make the smallest shared change that clears a stale `Base-Branch` on a primary/detached launch so `resolveMissionBaseBranch` falls back to the primary branch.
