# CP-3: Fix the `submit-for-review` guard in `mission-workflow.ts`

## Summary of work done
Modified the `submit-for-review` case of `decideMission` in
`src/domain/mission-workflow.ts`. The idempotency short-circuit previously fired
only for `status === 'review'`, so an `active` Mission carrying an already-decided
round was neither idempotent nor re-submittable: the `awaiting-review` guard at
`src/domain/mission-workflow.ts` threw
`A submitted review must be awaiting a reviewer decision`. Added a scoped
short-circuit, mirroring the `review` short-circuit, that recognises an
`active` Mission whose current round already has a `decision` and returns the
Mission moved to `review` with the round, its `decidedAt`, and its reviewed
change/PR passed through unchanged — no new decision invented, no round
rewritten. This is the second half of the bug (the missing `active → review`
path) and lets Branch A of `recoverMissionForIntegration` drive the downstream
`approve` at the stored `decidedAt`. The `ponytail:` ceiling (trusted stored
`approved` without a live provider approval) is documented inline; the integrate
recovery path gates this on an active Mission that also carries a provider
approval.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Guard no longer throws on active + decided round | `src/domain/mission-workflow.ts` submit-for-review short-circuit; `` `node --import tsx --experimental-test-module-mocks --test test/task-2397-integrate-active-approved-recovery.test.ts` `` green | PASS |
| Existing review short-circuit unchanged | `test/task-2339-submit-for-review-idempotent.test.ts`, `retrying submit-for-review on a review mission is an idempotent no-op` | PASS |
| approve still requires review (domain invariant intact) | `test/domain-mission.test.ts`, `mission lifecycle rejects unsupported jumps and missing handoff evidence` (approve from `backlog` still throws) | PASS |
| Fresh awaiting-review round still gated | `test/domain-mission.test.ts`, same test asserts fresh `active` submit-for-review still requires checkpoint evidence | PASS |

## Next action:
Commit CP-3. All acceptance criteria #1–#6 verified; run the full
`./scripts/verify-local.sh static-analysis` gate (CP-4).
