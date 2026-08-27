# CP-4: Verification gate, proof, and final Goal Check

## Summary
Implemented the full TASK-2420 fix and ran every mission-declared gate on the final tree.

Changes (committed in `52d519fe1`):
- `src/adapters/forgejo/forgejo-pr.ts` — `getLatestReviewDecision` gained a `reviewerUser` option and exposes `reviewerApproved` / `reviewerApprovedAt` for the assigned/configured reviewer's login, in addition to the repo default user ('human'). Fields attach only when `reviewerUser` is passed, so the pre-TASK-2420 result shape for whole-object callers is unchanged. Same supersedes rule as the default-user path.
- `src/adapters/cli/commands/integrate.ts` — added `resolveAuthoritativeApprovalAt()`; `recoveryEstablishesApproval` and `recoverMissionForIntegration` route a reviewer-matched approval through the same recovery path as the default-user approval, using the approval's own provider timestamp. `buildIntegrationContext` derives `reviewerUser` from the Mission's recorded current review round: `resolveForgejoUser(reviewState.reviewer)` (the round stores the reviewer as an AgentFamily; the login it posts as is `resolveForgejoUser(reviewer)`), fail-closed, never from the caller-supplied task assignee. Default-user path untouched (backward compatible).
- `test/task-2420-integrate-recovery-assigned-reviewer.test.ts` — 9 cases (3 `getLatestReviewDecision`, 3 `recoverMissionForIntegration`, 3 `buildIntegrationContext`: round-1 F1 reviewer-identity boundary, round-2 F1 authoritative-store default-reader pass, round-2 F1 negative control proving the store argument is required).
- Registered the new test in the integration suite (`test/lib/test-run-plan.ts`, `test/default-test-suite.test.ts`): it builds throwaway temp git repos like `task-2397`, so it crosses a real git boundary.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 assigned reviewer recovers to `integration` (no IntegrationAbort, correct occurredAt) | test name `"task-2420: active approved review by assigned reviewer recovers to integration"` in `test/task-2420-integrate-recovery-assigned-reviewer.test.ts` | PASS |
| SC2 stored approval without current provider approval aborts | test name `"task-2420: active approved review aborts when no current provider approval exists"` | PASS |
| SC3 unrelated current approval aborts | test name `"task-2420: active approved review aborts when the current approval is by an unrelated user"` | PASS |
| SC4 later REQUEST_CHANGES supersedes APPROVED | test name `"task-2420: a later REQUEST_CHANGES by the assigned reviewer supersedes the APPROVED"` | PASS |
| SC5 decision timestamp = qualifying reviewer approval timestamp | test name `task-2420: active approved review by assigned reviewer recovers to integration` in `test/task-2420-integrate-recovery-assigned-reviewer.test.ts:229` (`occurredAt: decidedAt` where `decidedAt = '2026-05-01T10:30:00Z''`) | PASS |
| SC6 default-user recovery path not regressed | `test/task-2397-integrate-active-approved-recovery.test.ts` (2 cases) | PASS |
| SC7 static-analysis clean on changed files | `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |
| Gate: static-analysis | `./scripts/verify-local.sh static-analysis` | PASS |
| Gate: integration suite | `npm run test:integration` → 2032 pass / 0 fail | PASS |
| Gate: full verification suite | `./scripts/verify-local.sh all` → 2173 pass / 0 fail | PASS |
| Fail-closed invariant (unrelated user cannot recover) | ADR 0048 (`docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`); reviewer login derived from recorded task identity, not caller context | PASS |
| Pre-TASK-2420 result shape preserved for whole-object callers | test name `"task-2420: getLatestReviewDecision rejects an APPROVED by an unrelated reviewer"` + `test/forgejo.test.ts` getLatestReviewDecision cases (whole-object deepEqual) | PASS |
| F1 reviewerUser derived from the recorded review round, not the implementer | test name `"task-2420: buildIntegrationContext derives reviewerUser from the recorded review round, not the implementer"` in `test/task-2420-integrate-recovery-assigned-reviewer.test.ts` (assignee `codex`, recorded reviewer `qwen`; asserts `reviewerUser === 'qwen'`) | PASS |
| F1 reviewerUser resolved via the authoritative Mission store (production reader needs the third `missionStore` arg) | test name `"task-2420: buildIntegrationContext passes the authoritative store to the default readReviewState reader"` + negative control `"...without the authoritative store does not derive the reviewer from the round"` in `test/task-2420-integrate-recovery-assigned-reviewer.test.ts`; `readReviewState(slug, rootDir, missionStore)` at `src/adapters/review/review-state.ts:144` | PASS |

## Next action
Round 2 F1 addressed: `buildIntegrationContext` now passes the authoritative Mission store to the default `readReviewState` reader and maps the round's reviewer AgentFamily to its Forgejo login via `resolveForgejoUser`. All three mission-declared gates pass (static-analysis ALL STAGES; integration 2032/0). Committed on `mission/task-2420`; do not push to `origin` (only `main` may push to origin).
