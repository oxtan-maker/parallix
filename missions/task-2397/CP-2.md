# CP-2: Fix Branch A recovery in `integrate.ts`

## Summary of work done
Modified `recoverMissionForIntegration` Branch A (`status === 'active'`) in
`src/adapters/cli/commands/integrate.ts`. When the latest review round is
already `approved`, Branch A now **skips** the `submitForReviewFn` handoff
replay (AC #2) and instead drives an `active → review` lane move through a
single direct `lifecycle.transition` with a `submit-for-review` command that
passes the existing round through unchanged. The workflow guard (CP-3)
recognises the decided round and advances the lane without rewriting it, so the
existing downstream `approve` fall-through runs at the stored `decidedAt`. A
genuinely fresh (`awaiting-review`) round still takes the original
`submitForReviewFn` handoff path unchanged (AC #3). Added the required
`agentFamily` / `ConfiguredReviewerEligibility` imports for the pass-through
reviewer eligibility (the guard advances before inspecting eligibility).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| #1 active + approved → integration, no abort | `test/task-2397-integrate-active-approved-recovery.test.ts`, `task-2397: active + approved review recovers to integration without resubmitting`, `` `node --import tsx --experimental-test-module-mocks --test test/task-2397-integrate-active-approved-recovery.test.ts` `` | PASS |
| #2 no `submitForReview` replay, round preserved | same test, asserts `submitForReviewCalled === false` and round `subject`/`decidedAt` unchanged; `src/adapters/cli/commands/integrate.ts` Branch A | PASS |
| #3 fresh round still handoffs unchanged | `test/integrate.test.ts`, `R4: stale active approved recovery skips submit-for-review replay...`, `` `node --import tsx --experimental-test-module-mocks --test test/integrate.test.ts` `` (77 pass) | PASS |
| #4 Branch B externally-approved recovery intact | `test/integrate.test.ts`, `recovery promotes an approved Review with its original decidedAt before integration` | PASS |
| #5 focused reproduction test exists | `test/task-2397-integrate-active-approved-recovery.test.ts` (2 tests) | PASS |

## Next action:
Commit CP-2, then implement CP-3 (workflow guard) — already applied in this
commit; verify the `submit-for-review` idempotency and domain suites still pass.
