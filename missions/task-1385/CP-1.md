# CP-1: Pre-review gate hook implemented

## Summary

Implemented the pre-review gate hook in `lib/review/review-loop.ts` that runs `runPreReviewGate` with mission area before each autonomous review round begins. The gate is invoked right after the rebase completes and the state transitions to 'reviewing', but before the reviewer agent is launched.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Verification gate runs via `runPreReviewGate` with mission area | `lib/review/review-loop.ts:1040` — `await runPreReviewGateFn(slug, worktree, {...})` |
| Runs before each autonomous review round | `lib/review/review-loop.ts:1039-1075` — gate check placed inside `if (state.phase === 'reviewing')` block, after rebase and state transition, before reviewer launch at `lib/review/review-loop.ts:1084` |
| Gate exit code is sole trusted signal | `lib/review/review-loop.ts:1045` — `if (!preReviewGateResult.ok)` checks exit-code-derived boolean, not textual claims |
| Existing reviewer gate check preserved | `lib/review/review-commands.ts:474-481` — unchanged, still runs `runVerificationGate` as secondary guard |

## Next action
Proceed to CP-2: Gate failure dispatch integrated with TASK-1389 error classifier.
