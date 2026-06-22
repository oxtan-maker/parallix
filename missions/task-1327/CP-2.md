# CP-2: Repair provider-backed review state transitions

Implemented a narrow backlog-state repair for provider-backed review submissions. `submitReviewRound` now invokes `repairStaleActiveTaskAfterReview` after a successful provider review post, and also after the self-author skip path that records the verdict locally. The repair only fires when the current task maps to virtual `active`; it promotes that stale state to `review` and leaves existing `review` / `approved` behavior unchanged.

Added two regression layers:
- a focused review-command test that proves provider-backed approval now triggers the `active -> review` repair;
- a real temp-repo test that proves both `status:` and rendered `Status:` are rewritten together.

Added an integration-facing regression that runs the repaired approval flow against a real task file and then confirms `evaluateTaskStatusForIntegration` accepts the resulting `review + APPROVED` state.

## Goal Check

| Check | Evidence | Status |
|---|---|---|
| Provider-backed review path repairs only stale `active` tasks | `lib/review/review-commands.js:91-115` helper gates on `toVirtual(currentStatus) === 'active'`; `lib/review/review-commands.js:930-938,960-967` invokes it after provider-backed approval recording | PASS |
| Provider-backed approval now promotes stale `active` to `review` | `test/review.test.js:2982` `submitReviewRound promotes an active backlog task to review after provider-backed approval` | PASS |
| YAML and rendered status lines stay aligned on the repaired task file | `test/review.test.js:3020` `submitReviewRound keeps YAML and rendered task status aligned when provider-backed approval repairs active` | PASS |
| Integration preflight now sees the corrected local status instead of stale `active` | `test/integrate.test.js:468` `provider-backed approval repair leaves integration preflight with review instead of stale active` | PASS |

Next action: Reproduce the `review-events` dirt path, then make successful review-artifact flows leave no untracked or modified `missions/<slug>/review-events/*` files behind.
