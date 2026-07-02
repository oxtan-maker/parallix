# CP-3: Auto-bounce mechanism implemented

## Summary

Implemented the auto-bounce mechanism in `handleGateFailureAutoBounce` (`lib/review/review-loop.ts:341-478`). On gate failure, the function:
1. Reads persisted retry count from review state metadata
2. Builds a fix prompt containing captured gate stdout/stderr, mission slug, area, and exit code
3. Transitions the task back to 'active' status without consuming a reviewer cycle
4. Relaunches the implementer agent with the fix prompt
5. Increments the retry counter in review state metadata

The mechanism does NOT consume a reviewer cycle or transition the task out of `review` status permanently — it transitions to 'active' (implementer phase) and the review loop continues on the next iteration.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Auto-bounce to implementer with gate output as fix prompt | `lib/review/review-loop.ts:404-424` — fix prompt includes stdout, stderr, mission slug, area, exit code |
| No reviewer cycle consumed | `lib/review/review-loop.ts:1070` — `continue` skips reviewer launch on bounce |
| Task stays in review workflow (transitions to active) | `lib/review/review-loop.ts:444` — `transitionTaskFn(slug, 'active', ...)` |
| Retry counter tracking in review state metadata | `lib/review/review-loop.ts:433` — `metadata.gateFailureRetryCount = retryCount + 1` |
| Test: auto-bounce bounces on first failure | `test/task-1385-pre-review-gate.test.js:149` — `handleGateFailureAutoBounce bounces on first failure` passes |
| Test: auto-bounce includes gate output in prompt | `test/task-1385-pre-review-gate.test.js:264` — prompt contains PRE-REVIEW GATE FAILURE, slug, area, stdout, stderr |

## Next action
Proceed to CP-4: Retry limit enforced (max 2 relaunches).
