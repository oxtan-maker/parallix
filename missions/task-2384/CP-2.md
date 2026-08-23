# CP-2 — Persist and surface approval owed

The existing reviewer-outcome event now records `external-formal-approval-owed` when Forgejo skips an approved self-review. The aggregate-derived loop state and status projection expose that marker, while the single-family fallback announces the external approval requirement and names every unavailable reviewer family with its launcher reason. The local approved verdict and the author-family fallback are unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 author-family escape hatch launches | `test/task-2384-reviewer-self-review-approval-owed.test.ts`, test `exhausted reviewer pool launches the PR author, retains its verdict, and marks formal approval owed` | PASS |
| SC2 pre-launch external-approval notice | `test/task-2384-reviewer-self-review-approval-owed.test.ts`, test `exhausted reviewer pool launches the PR author, retains its verdict, and marks formal approval owed` | PASS |
| SC3 local verdict and approval-owed state | `test/task-2384-reviewer-self-review-approval-owed.test.ts`, `reviewer_outcome` blocked reason `external-formal-approval-owed` | PASS |
| SC4 status shows formal approval pending | `test/task-2384-reviewer-self-review-approval-owed.test.ts`, `px status <slug>` | PASS |
| SC5 fallback diagnostic carries family reasons | `test/task-2384-reviewer-self-review-approval-owed.test.ts`, test `exhausted reviewer pool launches the PR author, retains its verdict, and marks formal approval owed` | PASS |
| SC6 regression passes after implementation | `npm test -- test/task-2384-reviewer-self-review-approval-owed.test.ts` | PASS |
| SC7 focused static checks are clean | `npm run typecheck`, `./scripts/verify-local.sh docs` | PASS — complete verifier remains CP-3 |

Next action: run the complete local verifier, capture the final gate evidence in CP-3, and commit the completed mission record.
