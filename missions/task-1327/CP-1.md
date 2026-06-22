# CP-1: Reproduce the stale task-state path

Traced the approval path that can leave the backlog task stale. In `submitReviewRound`, the standalone `provider=none` branch explicitly transitions the task (`lib/review/review-commands.js:828-870`), but the provider-backed branch only posts the review and rewrites `review-state.json` (`lib/review/review-commands.js:873-921`). That leaves no backlog transition when a Forgejo-backed approval lands on a task file still marked `active`.

Added a focused regression in `test/review.test.js` that forces the provider-backed path and asserts the task must be promoted out of `active` after approval. The test currently fails, which reproduces the mission symptom in a bounded way.

## Goal Check

| Check | Evidence | Status |
|---|---|---|
| Exact stale-state path identified | `lib/review/review-commands.js:828-870` transitions backlog only for `provider=none`; `lib/review/review-commands.js:873-921` lacks any backlog transition in the provider-backed branch | PASS |
| Failing regression added for provider-backed approval leaving task stale | `test/review.test.js:2982` `submitReviewRound promotes an active backlog task to review after provider-backed approval` | PASS |
| Regression fails before the fix, proving the symptom | `node --test test/review.test.js --test-name-pattern "submitReviewRound promotes an active backlog task to review after provider-backed approval"`; assertion shows expected `status: 'review'` vs missing transition | PASS |

Next action: Update the provider-backed approval path to promote stale `active` tasks to `review` without narrowing the existing `review + APPROVED` integration acceptance.
