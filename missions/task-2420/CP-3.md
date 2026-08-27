# CP-3: Wire reviewer-matched approval through recovery + focused unit tests

## Summary
Wired the assigned-reviewer approval (TASK-2420) through the recovery authority in `src/adapters/cli/commands/integrate.ts`:
- Added `resolveAuthoritativeApprovalAt(approval)` helper: returns the approval's own provider timestamp when either `defaultUserApproved` (repo default user) or `reviewerApproved` (assigned/configured reviewer) is set; default-user wins when both present. Never a bare boolean; the timestamp is the approval's own provider time (SC5).
- `recoveryEstablishesApproval` and `recoverMissionForIntegration` now use the helper instead of the hard-coded `defaultUserApproved` check, so a reviewer-matched approval routes through the same recovery path the default-user approval takes.
- `evaluateTaskStatusForIntegration` dry-run message now says "the provider approval" (was "default-user provider approval") to stay accurate for the reviewer path.
- `buildIntegrationContext` passes `reviewerUser: forgejoIdentity.forgejoUser` to `getLatestReviewDecisionFn`. The login is derived from the recorded task identity (`resolveForgejoUserForIntegration`), not caller context, so it cannot be forged (fail-closed, ADR 0048).

Did not rewrite the default-user path (backward compatible; Stop Rule). Did not touch `resolveForgejoUserForIntegration` (Restricted Area).

Added `test/task-2420-integrate-recovery-assigned-reviewer.test.ts` (6 cases, all green): assigned-reviewer APPROVED recognized by `getLatestReviewDecision`; unrelated reviewer rejected; later `REQUEST_CHANGES` supersedes; active + approved round by the assigned reviewer recovers to `integration` at the reviewer timestamp (submit-for-review skipped); stored approval with no current provider approval aborts; stored approval with an unrelated current approval aborts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 assigned reviewer recovers to integration | test name `"task-2420: active approved review by assigned reviewer recovers to integration"` | PASS |
| SC2 stored approval with no current approval aborts | test name `"task-2420: active approved review aborts when no current provider approval exists"` | PASS |
| SC3 unrelated current approval aborts | test name `"task-2420: active approved review aborts when the current approval is by an unrelated user"` | PASS |
| SC4 later REQUEST_CHANGES supersedes | test name `"task-2420: a later REQUEST_CHANGES by the assigned reviewer supersedes the APPROVED"` | PASS |
| SC5 decision timestamp = reviewer approval timestamp | asserted `occurredAt === decidedAt` in recovery test | PASS |
| SC6 default-user recovery path not regressed | `test/task-2397-integrate-active-approved-recovery.test.ts` | PASS |
| SC7 static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action
CP-4: run the full verification gates (`npm run test:integration`, `./scripts/verify-local.sh all`), capture proof, and fill the final Goal Check table.
