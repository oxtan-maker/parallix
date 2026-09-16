# CP-3 — status projection, cleanup sequencing, and focused regression coverage

Extended the focused regression coverage for the landed-recovery path and ran
the verification gate. The production recovery path (`recoverMissionLifecycle` /
`recoverLandedMission` in `src/application/mission-lifecycle-recovery.ts`, the
`landedMissionIntake` adapter in `src/adapters/cli/commands/recover-landed-intake.ts`,
the `px recover` wiring in `src/composition/create-cli.ts`, and the
close-out-then-cleanup ordering in `src/interfaces/cli/recover.ts`) was already
committed at CP-2. This checkpoint adds the two missing regression cases —
**unlanded refusal** and **failed-closeout cleanup protection** — to
`test/task-2516-recover-landed-mission-repro.test.ts`, registers that file in
the verification-tier registry, and closes the status-projection criterion.

## Work done

- Added `unlandedFixture()` to `test/task-2516-recover-landed-mission-repro.test.ts`:
  a completed task artifact, a recorded `Base-Branch: main`, a mission branch
  with a payload commit that is **never** squash-landed onto `main`, and a stale
  worktree/branch. The new test asserts `recoverMissionCommand` returns `false`,
  persists **zero** aggregates, and leaves the worktree and branch intact — the
  refusal path consults Forgejo merge state nowhere.
- Added the failed-closeout test: a store whose read-back closeout cannot be
  read as `done` makes `recoverMissionCommand` return `false` and asserts the
  injected `cleanup` was never invoked while the worktree and branch survive.
- Fixed fixture teardown in all three tests to unregister the temporary worktree
  with `git worktree remove --force` before deleting the branch, so repeated
  runs do not collide on a registered worktree.
- Registered `test/task-2516-recover-landed-mission-repro.test.ts` in
  `INTEGRATION_CI_TESTS` (`test/lib/test-categories.ts`) and in
  `expectedIntegrationFiles` (`test/default-test-suite.test.ts`) because the file
  seeds a real temporary Git repository with a worktree and crosses the git
  boundary; an unclassified boundary test fails `test/test-categories.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A valid landed mission recovers exactly once; a second attempt creates no second aggregate or transition | `test/task-2516-recover-landed-mission-repro.test.ts`, test `"TASK-2516: completed landed mission without an aggregate recovers once, projects done, then cleans up"`; asserts `stored.length === 1`, `stored[0].status === 'done'`, and the repeat call returns without writing (both `save` and `saveWithTransition` throw) | PASS |
| `px status <slug>` reports the recovered mission's durable closed/done state from the persisted aggregate | `test/task-2516-recover-landed-mission-repro.test.ts`, test `"TASK-2516: completed landed mission without an aggregate recovers once, projects done, then cleans up"` invokes the `px status` command seam and asserts `Backlog status: done`; `recoverLandedMission` reads the persisted aggregate back as done before cleanup | PASS |
| Valid-recovery removes only that mission's stale worktree and branch after the closeout write succeeds; a closeout failure leaves cleanup unattempted | same test's `cleanup` asserts `stored[0].status === 'done'` and `closedAt` before `git worktree remove`/`git branch -D`; `src/interfaces/cli/recover.ts` calls `deps.cleanup(slug)` only on `recovered-landed`; `test/task-2516-recover-landed-mission-repro.test.ts`, test `"TASK-2516: a closeout that cannot be read back leaves cleanup unattempted"` asserts cleanup is never invoked when the read-back closeout is not `done` | PASS |
| A payload absent from its recorded base branch is refused, creates no closed/done aggregate, and leaves the worktree and branch intact even if Forgejo reports a merged PR | `test/task-2516-recover-landed-mission-repro.test.ts`, test `"TASK-2516: unlanded payload is refused without mutation and leaves the worktree and branch intact"`; `landedMissionIntake` returns `null` (no `mission/<slug>:` squash subject on `main`), recovery returns `false`, `stored.length === 0`, worktree and branch survive; Forgejo state is never consulted (`src/adapters/cli/commands/recover-landed-intake.ts`) | PASS |
| Focused regression tests cover valid recovery, idempotent repeat, and unlanded refusal; the required verification gate runs | `test/task-2516-recover-landed-mission-repro.test.ts` (3 tests) passes with `node --import tsx --test test/task-2516-recover-landed-mission-repro.test.ts`; `./scripts/verify-local.sh all` is blocked before tests because this sandbox denies the `tsx` Unix IPC socket (`EPERM`) | BLOCKED |

## Gate note

`./scripts/verify-local.sh all` reaches its test stage, but this sandbox rejects
the `tsx` CLI's Unix IPC socket at `/tmp/tsx-1000/*.pipe` with `EPERM` before
the suite starts. The same test file passes through Node's non-IPC invocation:
`node --import tsx --test test/task-2516-recover-landed-mission-repro.test.ts`.

Next action: rerun `./scripts/verify-local.sh all` in an environment that
permits Unix-domain sockets for `tsx`.
