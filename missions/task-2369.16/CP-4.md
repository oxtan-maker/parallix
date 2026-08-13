# CP 4: Verify the physical split

Validated the extracted modules with focused review-setup tests, static analysis, and the repository’s full local verification suite.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Focused setup behavior remains covered without Forgejo access | `node --import tsx test/setup-review.test.ts`, `node --import tsx test/task-2364-owner-assumption.test.ts` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |
| Required general verification passes | `./scripts/verify-local.sh all` | PASS |
| Public compatibility exports and extracted owners remain in place | `src/adapters/review/setup-review.ts`, `src/adapters/review/setup-review-auth.ts`, `src/adapters/review/setup-review-repository.ts`, `src/adapters/review/setup-review-config.ts` | PASS |

Next action: Submit the physical review-setup split for review.
