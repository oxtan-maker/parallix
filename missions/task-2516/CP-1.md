# CP-1 — red recovery fixture

Added `test/task-2516-recover-landed-mission-repro.test.ts`. It creates a completed task artifact, records `Base-Branch: main`, squash-lands a mission payload on that base, leaves no Mission aggregate, and registers a stale worktree/branch. The exact assertion `the completed, squash-landed fixture must recover` is red at the mission parent commit because `recoverMissionLifecycle` rejects an absent aggregate.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A valid landed mission recovers exactly once | `test/task-2516-recover-landed-mission-repro.test.ts`, test `"TASK-2516: completed landed mission without an aggregate recovers once, projects done, then cleans up"`; `node --import tsx -e "import('./test/task-2516-recover-landed-mission-repro.test.ts')"` is red at the parent commit on `the completed, squash-landed fixture must recover` | RED |
| Status reports the recovered durable closed/done state | `test/task-2516-recover-landed-mission-repro.test.ts` asserts the persisted aggregate has `status: done` and `closedAt` before cleanup | RED |
| Cleanup follows closeout and is mission-scoped | `test/task-2516-recover-landed-mission-repro.test.ts` asserts closeout before the fixture worktree/`mission/task-2516-fixture` cleanup | RED |
| Unlanded payload is refused without mutation | `test/task-2492-already-merged-detection.test.ts`, test `"TASK-2492: branch with no committed payload is not reported as merged"` | PASS |
| Focused regression and required verification are runnable | `test/task-2516-recover-landed-mission-repro.test.ts`; `./scripts/verify-local.sh all` | PENDING |

Next action: implement the absent-aggregate landed-recovery decision in the existing recovery service, then make this fixture green.
