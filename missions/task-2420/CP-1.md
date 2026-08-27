# CP-1: Failing reproduction test that locks the bug

## Summary
Authoring the reproduction test that fails (red) before any fix, per the bug-labeled mission contract.

Created `test/task-2420-integrate-recovery-assigned-reviewer.test.ts` with 6 cases:
- `getLatestReviewDecision` recognizes an `APPROVED` by the assigned reviewer (`qwen`) → exposes `reviewerApproved` / `reviewerApprovedAt`.
- `getLatestReviewDecision` rejects an `APPROVED` by an unrelated reviewer.
- `getLatestReviewDecision` treats a later `REQUEST_CHANGES` by the assigned reviewer as superseding the `APPROVED`.
- `recoverMissionForIntegration` recovers an active + approved Mission (approved by the assigned reviewer) to `integration` at the reviewer approval timestamp, without resubmitting.
- `recoverMissionForIntegration` aborts a stored approval with no current provider approval.
- `recoverMissionForIntegration` aborts when the current provider approval is by an unrelated user.

All 6 are red before the fix (0 pass / 6 fail). `getLatestReviewDecision` currently returns no `reviewerApproved` field; `recoverMissionForIntegration` only honors `defaultUserApproved` and aborts with "stored approval without the required provider approval".

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test locks the assigned-reviewer bug (red pre-fix) | `node --import tsx test/task-2420-integrate-recovery-assigned-reviewer.test.ts` → 6 fail / 0 pass | PASS |
| Assigned-reviewer APPROVED is recognized by `getLatestReviewDecision` | test name `"task-2420: getLatestReviewDecision recognizes an APPROVED by the assigned reviewer"` | FAIL (red) |
| Unrelated reviewer APPROVED is rejected | test name `"task-2420: getLatestReviewDecision rejects an APPROVED by an unrelated reviewer"` | FAIL (red) |
| Later REQUEST_CHANGES supersedes APPROVED | test name `"task-2420: a later REQUEST_CHANGES by the assigned reviewer supersedes the APPROVED"` | FAIL (red) |
| Active approved review by assigned reviewer recovers to integration | test name `"task-2420: active approved review by assigned reviewer recovers to integration"` | FAIL (red) |
| Stored approval without current provider approval aborts | test name `"task-2420: active approved review aborts when no current provider approval exists"` | FAIL (red) |
| Unrelated current approval aborts | test name `"task-2420: active approved review aborts when the current approval is by an unrelated user"` | FAIL (red) |
| Fail-closed invariant (ADR 0048) preserved by design | `docs/adr/` fail-closed harness (see ADR refs below) | PASS |

## Next action
CP-2: add `reviewerUser` handling to `getLatestReviewDecision` in `src/adapters/forgejo/forgejo-pr.ts` so it exposes `reviewerApproved` / `reviewerApprovedAt` for the assigned reviewer's login while preserving `defaultUserApproved`.
