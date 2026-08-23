# CP-1: Reproduction test locks the bug

## Summary of work done
Added `test/task-2397-integrate-active-approved-recovery.test.ts`, which drives
`recoverMissionForIntegration` on an `active` Mission whose latest review round
is already `approved` (`decision.kind === 'approved'` with a `decidedAt`) and a
provider approval recorded (`context.approval.defaultUserApproved === true`).
The `submitForReviewFn` spy throws on call to stand in for the real workflow
guard rejection, so the reproduction is **red before the fix** (aborts with
`A submitted review must be awaiting a reviewer decision`, thrown at
`src/adapters/cli/commands/integrate.ts:1081`) and turns **green after the
fix**. The test asserts the recovery returns
`{ recovered: true, status: 'integration', occurredAt: <decidedAt> }`, drives
only the `approve` transition, and leaves the recorded decision, its
`decidedAt`, and the reviewed round untouched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test reproduces the `active + approved` abort | `test/task-2397-integrate-active-approved-recovery.test.ts`, `` `node --import tsx --test test/task-2397-integrate-active-approved-recovery.test.ts` `` returns the `A submitted review must be awaiting a reviewer decision` abort | RED (expected) |
| Test locks integration outcome at stored `decidedAt` | `test/task-2397-integrate-active-approved-recovery.test.ts`, tests `task-2397: active + approved review recovers to integration without resubmitting` / `... preserves the round across recovery` | PASS |
| Test enforces no `submitForReview` replay | `test/task-2397-integrate-active-approved-recovery.test.ts`, `submitForReviewFn` spy throws on call | PASS |

## Next action:
Implement CP-2 (Branch A recovery skip) and CP-3 (workflow guard) so the
reproduction turns green, then verify the existing `integrate.test.ts` recovery
suite still passes.
