# CP-2: Fix getLatestReviewDecision to recognize the assigned reviewer's APPROVED

## Summary
Fixed `getLatestReviewDecision` in `src/adapters/forgejo/forgejo-pr.ts` to recognize an `APPROVED` posted by the assigned/configured reviewer's Forgejo login (passed via the new `reviewerUser` option), in addition to the repo default user ('human').

Change:
- Added `reviewerUser` to the options and return shape.
- After the existing default-user logic, computed `reviewerApproved` / `reviewerApprovedAt` by filtering `formalReviews` to `reviewerUser` (when `reviewerUser` is set and differs from the default user). The same supersedes rule applies: a later `REQUEST_CHANGES` by the same reviewer retracts the approval.
- Kept `defaultUserApproved` / `defaultUserApprovedAt` intact and added `reviewerApproved` (always present) plus `reviewerApprovedAt` (only when set), so the whole-object shape callers compare is unchanged (ADR 0048 fail-closed; risk note in mission).

The assigned reviewer's login is resolved deterministically from the recorded task identity (`resolveForgejoUserForIntegration(taskAssignee)`), never from caller-supplied context.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Assigned-reviewer APPROVED recognized | test name `"task-2420: getLatestReviewDecision recognizes an APPROVED by the assigned reviewer"` | PASS |
| Unrelated reviewer APPROVED rejected | test name `"task-2420: getLatestReviewDecision rejects an APPROVED by an unrelated reviewer"` | PASS |
| Later REQUEST_CHANGES supersedes APPROVED | test name `"task-2420: a later REQUEST_CHANGES by the assigned reviewer supersedes the APPROVED"` | PASS |
| Existing default-user path preserved | `test/forgejo.test.ts` getLatestReviewDecision cases; `node --import tsx test/task-2397-integrate-active-approved-recovery.test.ts` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action
CP-3: wire the reviewer-matched approval through `recoverMissionForIntegration` / `recoveryEstablishesApproval` and add focused recovery unit tests (assigned-reviewer green, wrong-user red, later REQUEST_CHANGES red).
