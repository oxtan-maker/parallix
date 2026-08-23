# CP-1 — Red reproduction for self-review approval owed

Added a dependency-mocked reproduction that exhausts the reviewer pool to the PR-author `custom` family, verifies the self-review POST skip retains the local verdict, and requires an explicit approval-owed state plus status visibility. The test is red on the mission parent because selection does not announce the external approval requirement.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 author-family escape hatch launches | `test/task-2384-reviewer-self-review-approval-owed.test.ts`, test `exhausted reviewer pool launches the PR author, retains its verdict, and marks formal approval owed` | RED — reproduction selects `custom`; production behavior retained |
| SC2 pre-launch external-approval notice | `npm test -- test/task-2384-reviewer-self-review-approval-owed.test.ts`, test `exhausted reviewer pool launches the PR author, retains its verdict, and marks formal approval owed` | RED — no selection notice yet |
| SC3 local verdict and approval-owed state | `test/task-2384-reviewer-self-review-approval-owed.test.ts` | RED — local verdict exists but approval-owed state is absent |
| SC4 status shows formal approval pending | `test/task-2384-reviewer-self-review-approval-owed.test.ts` | RED — status has no approval-owed rendering |
| SC5 fallback diagnostic carries family reasons | `test/task-2384-reviewer-self-review-approval-owed.test.ts` | PENDING — implementation coverage follows in CP-2 |
| SC6 regression is red before fix | `npm test -- test/task-2384-reviewer-self-review-approval-owed.test.ts` | PASS — fails on the locked parent behavior |
| SC7 verifier cleanliness | `./scripts/verify-local.sh all` | PENDING — final gate belongs to CP-3 |

Next action: add the smallest persisted approval-owed marker, project it to `px status`, and enrich the single-family fallback notice and diagnostics.
