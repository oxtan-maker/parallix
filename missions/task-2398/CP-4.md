# Checkpoint 4 — Repair path documented; awaiting-review approve unchanged (CP-4)

## Summary

Documented the repair path for a mission already stuck in the inconsistent
state (approved disposition on a `fixing` round) and confirmed that a
legitimately `awaiting-review` approve is unchanged.

- Added "Repair path for a round already stuck in the inconsistent state" to
  `missions/task-2398/MISSION.md`. The stuck round cannot be repaired by
  re-running `approve` (now loud) and cannot be welded to `approved` without
  widening `REVIEW_PHASE_TRANSITIONS`. It reaches integration by resolving the
  outstanding findings (`applyImplementerCommand` `submit-resolution` ->
  `ready-for-next-round`), opening the next round (`beginNextReviewRound`), and
  approving that fresh `awaiting-review` round (`recordApproval` writes
  `decision.kind === 'approved'`). This uses only existing review-loop commands.
- Verified the repair path end-to-end against the domain (request-changes ->
  stuck `APPROVED`/`fixing` -> implementer resolution -> next round -> approve
  -> `approved`).
- Confirmed `awaiting-review` approve is unchanged: `recordApproval` records the
  authoritative decision and returns the Mission to `integration`, and a
  replayed approve reports `unchanged`. Existing approve tests are green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC4 documented repair path reaches integration | `missions/task-2398/MISSION.md`, "Repair path for a round already stuck in the inconsistent state"; repair flow verified against `src/domain/review.js` `applyImplementerCommand` / `beginNextReviewRound` / `applyReviewerCommand` | PASS |
| SC5 awaiting-review approve unchanged | `test/domain-review-workflow-state.test.ts`, `"dispositions that share a decision kind stay distinguishable"`, `test/task-2398-approve-fixing-round.test.ts`, `"records decision.kind === approved and moves the mission to integration"`, `"reports unchanged when an approve is replayed on an already-approved round"` | PASS |
| SC6 static analysis clean | `` `./scripts/verify-local.sh static-analysis` `` | PASS |

## Next action
CP-5: run the full `./scripts/verify-local.sh all` draft verification gate and capture proof.
