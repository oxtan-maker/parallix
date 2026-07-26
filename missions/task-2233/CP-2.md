# CP-2: Repair Classification/Routing and Focused Tests

## Summary

Fixed the gap where reviewer-non-submission bypassed the recovery loop prematurely. Two changes:

1. **Recovery loop break condition** (`review-loop.ts:1342-1345`): Changed from `if (!isPollTimeout(reviewState)) { break; }` to `if (!isPollTimeout(reviewState) && reviewState) { break; }`. This treats `null`/`undefined` as timeouts, so the recovery loop continues until the budget (2 retries) is exhausted instead of breaking on the first iteration when `pollForReview` returns `null` (no token) or `consumeReviewerArtifacts` yields `reviewState: null` (comment verdict with provider enabled).

2. **Post-loop escalation** (`review-loop.ts:1349-1355`): Changed from `if (isPollTimeout(reviewState))` to `if (isPollTimeout(reviewState) || !reviewState)`. This catches both `POLL_TIMEOUT` and `null` after the budget is exhausted, ensuring the escalation message always mentions "recovery retries." The former `!reviewState` check at lines 1353-1365 (check C) is now unreachable and removed.

3. **classifyError pattern** (`repair-handoff.ts:143-146`): Added pattern 11 matching reviewer-non-submission error messages ("did not submit a formal review outcome", "did not leave a complete local review handoff") → `InfraBlocker`/`HumanOnly`, per ADR 0048 classification.

4. **Unit tests** (`test/repair-handoff.test.ts`): Added 3 new tests for the reviewer-non-submission classifyError pattern.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Recovery loop completes 2 retries before escalation | `review-loop.ts:1342-1345` — break condition now requires truthy `reviewState`; `review-loop.ts:1349-1355` — post-loop escalation catches POLL_TIMEOUT and null | PASS |
| classifyError has reviewer-non-submission pattern | `repair-handoff.ts:143-146` — pattern 11 matches "did not submit/leave" → `InfraBlocker`/`HumanOnly` | PASS |
| classifyError unit tests for reviewer-non-submission | `test/repair-handoff.test.ts` — 3 tests: "formal outcome", "usable outcome", "local handoff" | PASS |
| Reproduction tests pass (red→green) | `test/task-2233-reviewer-non-submission-bounce.test.ts` — 4/4 passing (was 2/4 failing before fix) | PASS |
| Full test suite passes (no regressions) | `./scripts/verify-local.sh all` — 1270 tests, 0 failures | PASS |

## Next action:
Commit CP-1 and CP-2 changes, then proceed to CP-3: confirm e2e-real-agent-smoke test passes and verify every ADR 0048 review-bounce case has test coverage.
