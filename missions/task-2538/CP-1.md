# CP-1: Reproduce the Mistral fallback

Added a deterministic unit regression for a Mistral-family rate-limit failure with no reset timestamp. At the parent implementation it fails because the classifier returns the existing one-hour fallback (`2026-09-18 17`) rather than the next UTC month boundary.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| The no-reset Mistral-family fallback is reproduced as a red test | `test/limit-hit.test.ts`, `"detectLimitHit blocks the Mistral family through the end of the UTC month when no reset time parses"` | PASS |
| The regression is runnable against this checkpoint | `npm test -- test/limit-hit.test.ts` | PASS (red at parent behavior) |
| The focused test remains in the unit tier | `test/limit-hit.test.ts` | PASS |

Next action: make the classifier use the next UTC-month boundary only for unmatched-reset Vibe/Mistral limit hits.
