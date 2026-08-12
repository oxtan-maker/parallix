# CP-1: Reproduce approved-integration lifecycle omission

Added `test/task-2367-integration-completion-repro.test.ts`. It drives the normal local squash closeout with an approved Backlog task and an `integration` Mission double, then requires the post-landing order `landed`, `done`, `stats`.

Baseline: `9ccd6442cff531a76032267d2b0f87b7ac3404f7`; pre-existing worktree state included `package-lock.json` modified. The focused reproduction is red at this baseline: the landed integration leaves the Mission in `integration`, produces zero `integration -> done` events, and calls stats immediately after landing. Recent landed Mission evidence is `b74c05e13` (`git show --stat b74c05e13`), the task-2364 mission integration commit cited by the mission failure report.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Approved integration must persist lifecycle completion after landing | `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: a landed approved integration persists done once before statistics`; `npx tsx test/run-default-tests.ts test/task-2367-integration-completion-repro.test.ts` | RED — Mission remains `integration` at baseline |
| Exactly one integration completion event precedes statistics | `test/task-2367-integration-completion-repro.test.ts`, `TASK-2367: a landed approved integration persists done once before statistics` | RED — closeout never calls `MissionIntegrationService` |
| Historical integration evidence is identifiable | `git show --stat b74c05e13` | OBSERVED — recent task-2364 integration commit |

Next action: Add the CP-2 red regressions for pre-landing failure, lifecycle-unavailable reporting, telemetry completion, and nullable review-fix rounds.
