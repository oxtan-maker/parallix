# CP-3: Verify and document month-end blocking

Documented the distinct Vibe/Mistral no-reset limit behavior: it remains blocked until the first instant of the next UTC month, while other families retain the one-hour fallback. Both required mission gates passed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Vibe/Mistral no-reset blocks resolve at the next UTC month boundary | `test/limit-hit.test.ts`, `"detectLimitHit applies the Mistral month-end block to vibe at the UTC month boundary"` | PASS |
| Parsed reset and non-Mistral fallback behavior remain covered | `test/limit-hit.test.ts`, `"detectLimitHit honors a parsed Mistral reset before month-end"`, `"detectLimitHit returns reason for fallback source"` | PASS |
| Operator-facing behavior note distinguishes the monthly block | `docs/agents.md` | PASS |
| Full verification gate passed | `./scripts/verify-local.sh all` | PASS |
| Static-analysis gate passed | `./scripts/verify-local.sh static-analysis` | PASS |
| No focused or bare skipped tests were introduced | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: hand the committed mission branch to the Parallix lifecycle for review.
