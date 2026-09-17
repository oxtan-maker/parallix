# CP-2: Persist Vibe/Mistral blocks to month-end

Mapped the `vibe` launcher name to the existing Mistral pattern family. When a Vibe or Mistral limit hit has no future parsed reset, the classifier now writes a `month-end` block at the first instant of the next UTC month; parsed reset timestamps, the one-hour fallback for other families, and signal handling remain unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| No-reset Mistral-family failures end at the next UTC month boundary | `test/limit-hit.test.ts`, `"detectLimitHit blocks the Mistral family through the end of the UTC month when no reset time parses"` | PASS |
| Vibe uses the Mistral-family month-end behavior at a month boundary | `test/limit-hit.test.ts`, `"detectLimitHit applies the Mistral month-end block to vibe at the UTC month boundary"` | PASS |
| Parsed Mistral resets retain precedence | `test/limit-hit.test.ts`, `"detectLimitHit honors a parsed Mistral reset before month-end"` | PASS |
| Focused regression suite passes | `npm test -- test/limit-hit.test.ts` | PASS |

Next action: update the durable usage-limit behavior note and run both mission gates.
