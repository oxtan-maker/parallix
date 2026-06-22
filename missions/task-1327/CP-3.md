# CP-3: Clean up persisted review-event artifacts

Reproduced the review-artifact dirt bug with a real git-backed `consumeArtifacts` run. Before the fix, the command succeeded, moved the task to `review`, and still left `missions/<slug>/review-events/` untracked in the worktree.

Fixed the command by adding `commitPersistedReviewOutputs`, which reuses the mission-artifact auto-commit path after `consumeArtifacts` persists review events and transitions the backlog task. If that cleanup cannot commit the safe mission outputs, the command now fails instead of falsely reporting success.

## Goal Check

| Check | Evidence | Status |
|---|---|---|
| Successful artifact-consumption path now auto-commits persisted mission outputs | `lib/review/review-commands.js:117-124` defines `commitPersistedReviewOutputs`; `lib/review/review-commands.js:837-845` invokes it before the success return | PASS |
| Regression reproduces and now closes the `review-events` dirt path | `test/task-1209-consume-artifacts.test.js:93` `consumeArtifacts leaves no untracked review-events files after a successful transition` | PASS |
| The command still performs the original transition-and-persist work | `test/task-1209-consume-artifacts.test.js:12` `consumeArtifacts persists events and transitions backlog to review status (task-1209 SC4)` | PASS |

Next action: Run the mission gates, verify the task-1327 backlog classification remains exactly `ai_sdlc`, and write the final checkpoint with full goal-check evidence.
