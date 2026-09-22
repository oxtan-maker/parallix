# CP 3 — Correction and revised verification

## Summary of work done

Wired the operator-facing correction + revised-verification presentation into the
review loop so the causal chain is readable in the console (criterion 6 + 7):

1. **Revision change surfaced after `act-on-review`.** After the implementer
   reports `CHANGES_MADE`, the loop prints the new branch-head revision when it
   differs from the pre-fix head, so the operator sees the tree actually changed
   before the second review (`src/adapters/review/review-loop.ts`, beside
   `implementer made changes`); `beginNextReviewRound` records that revision on
   the aggregate (`src/domain/review.ts`).

2. **Post-fix verification rerun against the revised tree.** The round-2
   pre-review gate reruns the verification command against the revised tree; a
   failure bounces back to the implementer and never advances to the re-review
   (the pre-review gate-failure branch, `src/adapters/review/review-loop.ts`). A
   passing re-round gate prints `✓ verification passed against the revised tree
   (round N)` before the second review launches.

3. **Final approval associated with the later round.** `renderReviewVerdict`
   appends `· round N` to the `APPROVED` banner when `round > 1`
   (`APPROVED · round 2`), so the later-round approval is unambiguous
   (criterion 9).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Tree changes after the finding; new revision recorded | `src/domain/review.ts` `beginNextReviewRound`; `src/adapters/review/review-loop.ts` new-revision line beside `implementer made changes` | PASS |
| Verification reruns against the revised tree after correction | `src/adapters/review/review-loop.ts` round-2 pre-review gate; `test/task-2478-correction-presentation.test.ts` "re-round reruns verification against the revised tree and approves round 2" asserts `✓ verification passed against the revised tree (round 2)` | PASS |
| Failed verification does not advance to re-review | `src/adapters/review/review-loop.ts` pre-review gate-failure bounce branch (returns / bounces, never advances) | PASS |
| Second review evaluates the revised revision, not the pre-fix tree | `src/domain/review.ts` `beginNextReviewRound` sets round-2 `subject.revision` to the implementer's resulting revision; `test/task-2358-multi-round-repro.test.ts` | PASS |
| Final approval associated with the later round | `src/adapters/review/review-loop.ts` `renderReviewVerdict` `· round N`; `test/task-2478-correction-presentation.test.ts` "APPROVED verdict carries the round number on a re-round" + the re-round test asserts `APPROVED · round 2` | PASS |
| Full correction chain end-to-end in one run | `test/task-2478-correction-presentation.test.ts` "re-round reruns verification … and approves round 2" drives round 1 REQUEST_CHANGES → CHANGES_MADE → round 2 APPROVED | PASS |

## Next action
Commit CP-3. Then CP 4: add focused tests proving a stale earlier-round approval
cannot satisfy the later round and that `CHANGES_MADE` alone is not proof the
finding was resolved (criterion 8, ADR 0048 fail-closed), using the Review
aggregate commands in `src/domain/review.ts`.
