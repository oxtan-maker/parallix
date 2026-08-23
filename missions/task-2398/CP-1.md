# Checkpoint 1 — Reproduction test locks the bug (red)

## Summary

Author a focused test that reproduces the task-2380 regression and fails red at
the mission's parent commit. The regression: an `approve` verdict reported
`[PASS]` while writing no authoritative `ReviewerDecision` whenever the current
round was not `reviewing`; from `fixing` the phase transition is swallowed and
the aggregate keeps `decision.kind === 'changes-requested'` over
`disposition === 'APPROVED'`, so `recoveryEstablishesApproval`
(`integrate.ts`) refuses integration forever.

The reproduction locks both halves of the invariant behind the new aggregate
`recordApproval` (the `approve` counterpart to `recordRequestedChanges`):

- SC1 — `approve` on a legitimately `awaiting-review` round records
  `decision.kind === 'approved'` and returns the mission to `integration`.
- SC2 — `approve` on a `fixing` round (request-changes then approve) fails
  loudly and leaves the `changes-requested` decision untouched, so the
  integration gate (`lastRound.decision.kind === 'approved'`) still refuses.

At the parent commit `recordApproval` does not exist, so the import fails and
the whole file errors — the test fails red before the fix.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 awaiting-review approve is authoritative | `test/task-2398-approve-fixing-round.test.ts`, `"records decision.kind === approved and moves the mission to integration"`, `` `npm test test/task-2398-approve-fixing-round.test.ts` `` | PASS |
| SC2 approve on fixing round fails loudly | `test/task-2398-approve-fixing-round.test.ts`, `"rejects approve after request-changes and leaves the changes-requested decision"`, `` `npm test test/task-2398-approve-fixing-round.test.ts` `` | PASS |
| SC4 red-to-green locks task-2380 + integration gate | `test/task-2398-approve-fixing-round.test.ts`, `"locks the task-2380 stuck state: an approving fixing round never satisfies the integration gate"`, fails red at parent commit `39ea4c26a` | PASS |
| SC3 both approve paths have focused tests | `test/task-2398-approve-fixing-round.test.ts`, `"TASK-2398 SC3: review-artifacts.ts approve path (recordLocalReviewVerdict)"` | PASS |
| SC5 existing approve behaviour preserved | `test/domain-review-workflow-state.test.ts`, `"dispositions that share a decision kind stay distinguishable"`, `` `npm test test/domain-review-workflow-state.test.ts` `` | PASS |

## Next action
CP-2: fix `submitReviewOutcome` approve path in `src/adapters/review/review-commands.ts` to record an authoritative `approved` decision and fail loudly on an illegal transition.
