# CP-1 — Red-state re-review lifecycle coverage

Added deterministic lifecycle tests for the post-response transition. The tests
show that `PUSHBACK_ALL` currently stops after the implementer response instead
of selecting the active reviewer for a formal re-review decision.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Responses route to the active reviewer rather than directly to a human | `test/task-2239-rereview-after-response.test.js`, "post-response transition re-launches the active reviewer and records exactly one next round before approval" | RED |
| Re-review retains round history and advances the persisted round once | `test/task-2239-rereview-after-response.test.js`, "post-response transition re-launches the active reviewer and records exactly one next round before approval" | RED |
| Reviewer approval after a response completes automated review | `test/task-2239-rereview-after-response.test.js`, "post-response transition re-launches the active reviewer and records exactly one next round before approval" | RED |
| Repeat reviewer request-changes remains in the loop | `test/task-2239-rereview-after-response.test.js`, "post-response transition keeps the loop active when the reviewer requests changes again" | RED |
| Reviewer failure and retry exhaustion retain explicit human-escalation reasons | `test/task-2239-rereview-after-response.test.js`, "reviewer launch failure after a response records a reviewer-specific human escalation reason"; "post-response transition escalates at the maximum reviewer-attempt boundary without launching another reviewer" | RED |
| Deterministic coverage exists for all four required paths | `node --test test/task-2239-rereview-after-response.test.js` | RED — 4 expected failures before implementation |
| Documented workflow behavior matches routing | `lib/review/review-loop.ts:1526` | PENDING |

Next action: replace the `PUSHBACK_ALL` terminal transition in `startReviewLoop` with a persisted re-review phase, then record reviewer-specific human-escalation reasons.
