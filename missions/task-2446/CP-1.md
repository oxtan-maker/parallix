# CP-1 — Red lifecycle-conflict reproduction

Added the TASK-2438-shaped reproduction before production recovery code. It fixes the expected operator contract: an active worktree task paired with a closed durable aggregate must report both states, offer `recover-to-active`, and leave an auditable recovery lane event.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2438-shaped conflict is reproducible and initially rejected | `test/task-2446-repro.test.ts`; `"TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active"`; `npm test -- --test-name-pattern='TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active' test/task-2446-repro.test.ts` fails before the recovery module exists | Complete (red) |
| Conflict reports both states and a recovery action | `test/task-2446-repro.test.ts` | Pending implementation |
| Non-integrated conflict resumes with history | `test/task-2446-repro.test.ts` | Pending implementation |
| Integrated mission recovery is refused unchanged | `test/task-2446-repro.test.ts` | Pending focused coverage |
| TASK-2438 reaches compatible persisted states | `test/task-2446-repro.test.ts` | Pending supported-path execution |
| Focused tests and static analysis pass | `./scripts/verify-local.sh static-analysis` | Pending implementation |

Next action: implement the checked recovery boundary and connect it to `px active --recover` before agent launch.
