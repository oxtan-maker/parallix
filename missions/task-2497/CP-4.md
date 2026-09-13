# CP-4 — One cleanup attempt with actionable failure

The recover command invokes the existing guarded `cleanupMissionWorktree` seam
once after a landed-mission refusal. A false cleanup result keeps recovery
non-completing and reports the retry command with the affected slug.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Landed mission cleanup is invoked exactly once | `test/task-2446-repro.test.ts`, `"TASK-2492: recover command does not resume a landed active mission"` | PASS |
| Cleanup uses the existing guarded worktree seam | `src/composition/create-cli.ts`, `src/adapters/cli/commands/integrate-post.ts` | PASS |
| Cleanup failure is durable and actionable | `test/task-2446-repro.test.ts`, `"TASK-2492: cleanup failure leaves recovery actionable"` | PASS |
| Recovery does not claim completion after cleanup failure | `npm test -- test/task-2446-repro.test.ts` | PASS |

Next action: run the declared final verification gate and record the completed regression evidence.
