# CP 1 — Red reproduction

Added a focused review-port reproduction that launches `conflict-resolution` after retaining one shared file. The project test command fails on the mission parent because `rebaseBeforeReviewRound` replaces `port.startAgent` with a wrapper.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The reproduction launches `conflict-resolution` through the workflow port and asserts `sharedFileConflicts` | `test/review.test.ts`, `rebaseBeforeReviewRound derives sharedFileConflicts from sharedFiles when the conflict-resolution agent launches` | PASS (red on parent) |
| The redundant flag and wrapper are absent | `src/adapters/review/rebase.ts` | Pending CP 2 |
| Required verification succeeds | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all` | Pending CP 3 |

Next action: Remove the `startAgent` wrapper and derive the result only from the captured `sharedFiles`.
