# CP 2 — Remove redundant launch state

Removed the `conflictAgentLaunched` variable and `port.startAgent` wrapper. `sharedFileConflicts` now uses the final captured `sharedFiles` set alone. The CP 1 reproduction passes unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The reproduction launches `conflict-resolution` through the workflow port and asserts `sharedFileConflicts` | `test/review.test.ts`, `rebaseBeforeReviewRound derives sharedFileConflicts from sharedFiles when the conflict-resolution agent launches`, `npm test -- --test-name-pattern='rebaseBeforeReviewRound derives sharedFileConflicts from sharedFiles when the conflict-resolution agent launches' test/review.test.ts` | PASS |
| The redundant flag and wrapper are absent | `src/adapters/review/rebase.ts` | PASS |
| Required verification succeeds | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all` | Pending CP 3 |

Next action: Run the mission static-analysis and full verification gates on this committed cleanup.
