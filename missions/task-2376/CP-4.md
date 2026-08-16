# CP-4 — Reconcile stale lifecycle states before integration

## Summary

Moved lifecycle recovery ahead of `px integrate` preflight and merge work.
`recoverMissionForIntegration()` loads the authoritative Mission and invokes the
existing lifecycle `approve` operation for a stale approved Review, using the
stored `ReviewerDecision.decidedAt` exactly. It leaves already-integrating and
resumed done Missions alone, and fails closed with actionable guidance when an
active Mission has no authoritative Review facts or a review has no approval.

For active Missions that retain Review facts, recovery invokes the existing
`submitForReview` handoff operation rather than assigning a Mission status.
Backlog promotion remains delayed until closeout, after lifecycle reconciliation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Stale approved `review` is transitioned through the lifecycle operation before preflight | `src/adapters/cli/commands/integrate.ts` `recoverMissionForIntegration`; `"recovery promotes an approved Review with its original decidedAt before integration"` | PASS |
| Recovery records the original authoritative approval time | `test/integrate.test.ts` `"recovery promotes an approved Review with its original decidedAt before integration"`; `npm test -- test/integrate.test.ts` | PASS |
| Active state with no Review facts stops without inferred lifecycle state | `test/integrate.test.ts` `"recovery refuses an active Mission without authoritative Review facts"` | PASS |
| Recovery uses existing submit-for-review behavior rather than status mutation | `src/adapters/cli/commands/integrate.ts` `recoverMissionForIntegration`; `src/adapters/review/review-commands.ts` `submitForReview` | PASS |
| Focused regression and type verification pass | `npm test -- test/integrate.test.ts`; `npx tsc --project tsconfig.test.json --noEmit` | PASS |

Next action: CP-5 — restrict the domain `integrate` command to `integration` only and rerun the lifecycle recovery regressions.
