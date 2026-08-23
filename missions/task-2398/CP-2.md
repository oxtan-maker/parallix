# Checkpoint 2 — Fix `submitReviewOutcome` approve path (CP-2)

## Summary

Add the aggregate counterpart to `approve` and wire it into `submitReviewOutcome`.

- `src/adapters/review/review-round.ts`: export `recordApproval`, the mirror of
  `recordRequestedChanges`. It loads the Mission, and — because `approve` is a
  domain decision, not only a provider comment — calls `applyReviewerCommand`
  with `{ type: 'approve' }` to write `decision.kind === 'approved'` on the
  Review aggregate, then returns the Mission to `integration` through the same
  lifecycle boundary `recordRequestedChanges` uses for `review -> active`.
  Idempotent: a replayed approve on an already-approved round reports
  `unchanged`. An approve that cannot legally move the round to `approved`
  (e.g. still `fixing` / `awaiting-implementation`) fails loudly with a
  diagnostic naming the transition instead of writing
  `disposition === 'APPROVED'` over a `changes-requested` decision. This does
  not touch `REVIEW_PHASE_TRANSITIONS` — it only refuses the illegal edge.

- `src/adapters/review/review-commands.ts`: `submitReviewOutcome` records the
  approve on the aggregate **before** any provider interaction, mirroring the
  existing `request-changes` block. A `failed` outcome exits non-zero with an
  actionable message; an `unchanged` outcome logs `INFO`. This stops the
  swallowed `[PASS]` that left the round permanently unintegratable.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 approve on fixing fails loudly, no bad disposition | `src/adapters/review/review-round.ts` `recordApproval`, `test/task-2398-approve-fixing-round.test.ts`, `"rejects approve after request-changes and leaves the changes-requested decision"` | PASS |
| SC1 authoritative approval on awaiting-review | `src/adapters/review/review-round.ts` `recordApproval` -> `applyReviewerCommand`, `test/task-2398-approve-fixing-round.test.ts`, `"records decision.kind === approved and moves the mission to integration"` | PASS |
| SC5 awaiting-review approve unchanged | `test/domain-review-workflow-state.test.ts`, `"dispositions that share a decision kind stay distinguishable"`, `test/task-2398-approve-fixing-round.test.ts`, `"reports unchanged when an approve is replayed on an already-approved round"` | PASS |
| SC6 static analysis clean | `` `./scripts/verify-local.sh static-analysis` `` | PASS |

## Next action
CP-3: fix `recordReviewVerdict` (`recordLocalReviewVerdict`) approve path in `src/adapters/review/review-artifacts.ts` to the same loud-failure + authoritative-write behaviour.
