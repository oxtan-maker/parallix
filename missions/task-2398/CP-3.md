# Checkpoint 3 — Fix `recordReviewVerdict` approve path (CP-3)

## Summary

Apply the same loud-failure + authoritative-write behaviour to the second named
approve path, `recordLocalReviewVerdict` in `src/adapters/review/review-artifacts.ts`
(the function the task references as `recordReviewVerdict`), which records a
verdict locally on the self-author path of `postWorkflowReview`.

- `recordLocalReviewVerdict` now records the approve on the Review aggregate
  through `recordApproval` before the flat loop-state write, when a Mission
  authority is bound. A `failed` outcome throws so `postWorkflowReview` returns
  `ok: false` (the self-author branch no longer reports a skipped POST and
  leaves the mission unintegratable); an `unchanged` outcome logs `INFO`. When
  no Mission authority is bound it logs the same `WARN` as `submitReviewOutcome`
  and defers to the flat state, mirroring the existing no-authority behaviour.
- `recordApprovalFn` and `lifecycleService` are threaded from `consumeReviewerArtifacts`
  through `postWorkflowReview` to `recordLocalReviewVerdict`, and the real
  `recordApproval` is the default so the composition binding is unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 both approve paths covered | `test/task-2398-approve-fixing-round.test.ts`, `"TASK-2398 SC3: review-artifacts.ts approve path (recordLocalReviewVerdict)"`, `src/adapters/review/review-artifacts.ts` `recordLocalReviewVerdict` | PASS |
| SC2 review-artifacts approve on fixing fails loudly | `test/task-2398-approve-fixing-round.test.ts`, `"fails loudly on a fixing round and leaves the changes-requested decision"` | PASS |
| SC1 review-artifacts approve on awaiting-review authoritative | `test/task-2398-approve-fixing-round.test.ts`, `"records an authoritative approval on an awaiting-review round"` | PASS |
| SC5 existing self-author approve still works | `test/review-artifacts.test.ts`, `"postWorkflowReview skips the Forgejo POST when reviewer is the PR author"`, `` `npm test test/review-artifacts.test.ts` `` | PASS |
| SC6 static analysis clean | `` `./scripts/verify-local.sh static-analysis` `` | PASS |

## Next action
CP-4: document the repair path for a mission already stuck in the inconsistent state (approved disposition on a `fixing` round), and confirm `awaiting-review` approve is unchanged.
