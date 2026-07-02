# CP-4: Retry limit enforced

## Summary

Implemented retry limit enforcement in `handleGateFailureAutoBounce` (`lib/review/review-loop.ts:382-395`). The max retry count is `MAX_GATE_RETRY = 2`, aligned with TASK-1387 specification. When the retry count reaches the limit:
1. The mission strands with a clear "max retries exceeded" message
2. The gate output is logged for diagnostic purposes
3. The function returns `{ bounced: false, stranded: true }`
4. The review loop exits with error code 1 at `lib/review/review-loop.ts:1064-1067`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Max 2 relaunches per gate failure | `lib/review/review-loop.ts:382` — `const MAX_GATE_RETRY = 2` |
| Strands mission after limit exceeded | `lib/review/review-loop.ts:390-394` — returns `{ bounced: false, stranded: true }` |
| Clear "max retries exceeded" message | `lib/review/review-loop.ts:391` — `Pre-review gate failure: max retries exceeded (${MAX_GATE_RETRY})` |
| Human intervention required message | `lib/review/review-loop.ts:392` — `Human intervention required` |
| Gate output logged for diagnostics | `lib/review/review-loop.ts:393` — `Gate output:\n${gateResult.stdout || gateResult.stderr}` |
| Review loop exits on stranded | `lib/review/review-loop.ts:1064-1067` — `exit(1); return` on stranded |
| Test: strands when retry limit exceeded | `test/task-1385-pre-review-gate.test.js:228` — `handleGateFailureAutoBounce strands when retry limit exceeded` passes |
| Test: bounces on second failure (count goes to 2) | `test/task-1385-pre-review-gate.test.js:193` — `handleGateFailureAutoBounce bounces on second failure` passes, asserts retry count = 2 |

## Next action
Proceed to CP-5: Area-scoped gate selection working.
