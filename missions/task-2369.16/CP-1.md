# CP 1: Re-establish the review-setup baseline

Restored the pre-facade review-setup implementation, removed the forwarding-only split, and captured the stable public import surface before moving code.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Largest review-setup module is reduced by a real split | `src/adapters/review/setup-review.ts`, `src/adapters/review/setup-review-auth.ts`, `src/adapters/review/setup-review-repository.ts`, `src/adapters/review/setup-review-config.ts` | PASS |
| Existing public imports remain supported | `test/setup-review.test.ts`, `test/task-2364-owner-assumption.test.ts` | PASS |
| No forwarding-only modules remain | `src/adapters/review/setup-review-*.ts` | PASS |

Next action: Verify the extracted boundaries with the focused setup suite.
