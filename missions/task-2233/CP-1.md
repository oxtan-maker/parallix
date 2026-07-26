# CP-1: Red Deterministic Reproduction and ADR-to-Code Mapping

## Summary

Authored a failing reproduction test suite (`test/task-2233-reviewer-non-submission-bounce.test.ts`) that locks the bug: the recovery loop's break condition `if (!isPollTimeout(reviewState))` treats `null` as "not a timeout" and breaks prematurely, causing the `!reviewState` check at `review-loop.ts:1353-1365` to fire the error "Reviewer X did not submit a formal review outcome" without completing the ADR 0048 bounded recovery retries.

Mapped each ADR 0048 review-bounce control to its implementation location:

| Control | ADR 0048 | Implementation Location | Notes |
|---------|----------|------------------------|-------|
| C1: Pre-review gate auto-bounce | C1 | `review-loop.ts:229-360` (`runPreReviewGate`, `handleGateFailureAutoBounce`) | Gate runs before each review round; auto-bounces on failure |
| C2: Gate-failure auto-send-back | C2 | `repair-handoff.ts:172-240` (`buildGateFailurePrompt`, `buildRelaunchPrompt`) | Captured gate output sent to implementer with retry limit 2 |
| C3: Error classifier and dispatch | C3 | `repair-handoff.ts:36-150` (`classifyError`, `DISPATCH_TABLE`, `FailureClass`) | 8-class dispatch table with explicit patterns |
| C6: Infra blocker classification | C6 | `repair-loop.ts:277-285` (`classifyGateFailure`) + `repair-handoff.ts:139-141` | Delegates to shared classifier; InfraBlocker strands instead of relaunching |
| Reviewer recovery retries | — | `review-loop.ts:1285-1350` (recovery loop) | Bounded to 2 retries; REVIEWER_NON_APPROVAL escalation |
| Declared-gate auto-bounce | — | `review-loop.ts:825-845` (handoff validation-failed path) | Auto-bounces to active on declared-gate validation failure |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Red reproduction test locks the bug | `test/task-2233-reviewer-non-submission-bounce.test.ts` — 3 failing tests confirm `reviewerRetryCount` is 1 (not 2) when `pollForReview` returns `null` or `forgejoEnabled=false` | PASS |
| ADR 0048 controls mapped to code locations | `review-loop.ts:229-360` (C1), `repair-handoff.ts:36-150` (C3), `review-loop.ts:1285-1350` (recovery loop), `ADR 0048` | PASS |
| classifyError handles reviewer-non-submission | `repair-handoff.ts:143-146` — new pattern 11 matches "did not submit/leave" messages → `InfraBlocker`/`HumanOnly` | PASS |

## Next action:
Write CP-2 checkpoint document documenting the recovery loop fix and classifyError pattern addition, then commit CP-1 changes and proceed to CP-3 verification.
