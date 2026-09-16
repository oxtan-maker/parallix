# CP-2 — landed-recovery decision for an absent aggregate

`recoverMissionLifecycle` now handles the `missing` aggregate case through `recoverLandedMission` (`src/application/mission-lifecycle-recovery.ts`): it requires a completed task status, asks the injected `landedIntake` port for durable landing proof, writes exactly one closed/done aggregate via `saveWithTransition(mission, null, …)` with a `close` lane event, and reads the aggregate back as `done` with a `closedAt` before reporting the new `recovered-landed` action.

The proof adapter is `landedMissionIntake` (`src/adapters/cli/commands/recover-landed-intake.ts`): completed task artifact, resolvable recorded base branch (`resolveMissionBaseBranch`), and a `mission/<slug>:` squash-commit subject in that base branch's log. Forgejo state is never consulted. `src/composition/create-cli.ts` wires it into `px recover`; `src/interfaces/cli/recover.ts` runs cleanup only after the read-back closeout.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A valid landed mission recovers exactly once | `test/task-2516-recover-landed-mission-repro.test.ts`, test `"TASK-2516: completed landed mission without an aggregate recovers once, projects done, then cleans up"`; `node --import tsx --test test/task-2516-recover-landed-mission-repro.test.ts` passes (red at the mission parent commit on `the completed, squash-landed fixture must recover`) | PASS |
| Status reports the recovered durable closed/done state | same test asserts the persisted aggregate is `status: done` with `closedAt`, read back through `store.load` in `recoverLandedMission` | PASS |
| Cleanup follows closeout and is mission-scoped | same test's `cleanup` asserts `stored[0].status === 'done'` before removing the fixture worktree and `mission/task-2516-fixture`; `src/interfaces/cli/recover.ts` calls `deps.cleanup(slug)` only on `recovered-landed` | PASS |
| Unlanded payload is refused without mutation | `test/task-2492-already-merged-detection.test.ts`, test `"TASK-2492: branch with no committed payload is not reported as merged"` | PASS |
| Focused regression and required verification are runnable | `test/task-2516-recover-landed-mission-repro.test.ts`; `./scripts/verify-local.sh all` | PENDING |

Next action: CP-3 — add focused refusal and failed-closeout regression coverage for the recovery path and run `./scripts/verify-local.sh all`.
