# CP-3: Verify the fix contract and unchanged exceptions

The code on this branch already implements the smallest safe fix the mission asked for: successful relaunches are not treated as durable success by themselves. `runHandoffAndReview()` now re-runs `_performHandoff()` after relaunch and only reaches `startReviewLoop()` through the shared success path; meanwhile, repair-success retries, gatekeeper pushback, and manual-failure handling all remain intact.

## Goal Check

| Goal Check | Evidence | Status |
|-----------|----------|--------|
| Repair-success retry still uses the established forced follow-up handoff path | [lib/commands/active.js](/home/magnus/code/parallix-task-1324/lib/commands/active.js:420) retries `_performHandoff(..., force: true)` after `repairHandoffFn()` returns `repaired: true`; covered by [test/active.test.js](/home/magnus/code/parallix-task-1324/test/active.test.js:405) `runHandoffAndReview retries handoff once after successful repair with force:true` | PASS |
| Relaunch success uses the same durable contract instead of returning success immediately | [lib/commands/active.js](/home/magnus/code/parallix-task-1324/lib/commands/active.js:433) to [lib/commands/active.js](/home/magnus/code/parallix-task-1324/lib/commands/active.js:440) re-run `_performHandoff()` and rewrite the error if the post-relaunch handoff still fails | PASS |
| Gatekeeper pushback remains a success-without-review-transition exception and does not start the review loop | [lib/commands/active.js](/home/magnus/code/parallix-task-1324/lib/commands/active.js:457) and [test/active.test.js](/home/magnus/code/parallix-task-1324/test/active.test.js:566) `runHandoffAndReview skips startReviewLoop when gatekeeper posted pushback` | PASS |
| Normal successful handoff still starts the autonomous review loop after the shared success path | [lib/commands/active.js](/home/magnus/code/parallix-task-1324/lib/commands/active.js:462) and [test/active.test.js](/home/magnus/code/parallix-task-1324/test/active.test.js:580) `runHandoffAndReview starts review loop when gatekeeper did not push back` | PASS |

Next action: Run the mission gates to completion and record the final verification evidence in the handoff-ready checkpoint.
