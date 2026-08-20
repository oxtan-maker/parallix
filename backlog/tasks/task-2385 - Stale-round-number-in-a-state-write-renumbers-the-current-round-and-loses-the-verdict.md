---
id: TASK-2385
title: Stale round number in a state write renumbers the current round and loses the verdict
status: refined
assignee: [codex]
created_date: '2026-08-20 19:14'
labels:
  - bug
  - user_value
dependencies: []
references:
  - src/adapters/review/review-state-mapping.ts
  - src/adapters/review/review-artifacts.ts
  - src/adapters/sqlite/mission-store.ts
  - src/adapters/review/review-state.ts
priority: high
ordinal: 102917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A flattened review-state write that carries a round number lower than the aggregate's current round silently renumbers the newest round downward, which then fails the round uniqueness constraint and drops the verdict on the floor.

`applyReviewStateToReview` (`src/adapters/review/review-state-mapping.ts:134-150`) only grows the round list toward `state.round`. It has no lower bound: after the grow loop it unconditionally rewrites the last round through `roundFromState` (`:107`), which sets `number` from `state.round` whenever that value is a positive number. With an aggregate holding rounds [1, 2] and a state carrying `round: 1`, round 2 is rewritten as round 1 and `SqliteMissionStore` (`src/adapters/sqlite/mission-store.ts:498`) then inserts two rows with the same `round_number`.

Observed on mission task-2377.05 immediately after the round-2 review approved (operator log, 2026-08-20T18:51Z):

`[FAIL] Review-state persistence failed for mission task-2377.05, phase approved, round 1, stage write: UNIQUE constraint failed: mission_review_rounds.mission_id, mission_review_rounds.round_number`

The loop was on round 2. `px status task-2377.05` afterwards still reports `round 2, phase reviewing, disposition none` — the approval was never recorded, while the reviewer artifacts and PR comment did land. The mission is stuck with a completed review that the operator database does not know about.

Likely source of the stale `1`: `recordLocalReviewVerdict` (`src/adapters/review/review-artifacts.ts:213-220`) constructs a fresh `ReviewState` with a hardcoded `round: 1` whenever `readReviewState` returns a falsy value, so a read miss silently downgrades the round instead of failing. Confirm this is the actual producer before fixing it; the mapper defect stands on its own either way.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A state update carrying a round number lower than the aggregate's current round never renumbers an existing round; the round list is monotonic
- [ ] #2 Such an update is rejected with a diagnostic naming both round numbers, rather than being silently applied or silently ignored
- [ ] #3 The producer of the stale round number is identified and fixed: a review-state read miss during verdict recording must not fabricate `round: 1`
- [ ] #4 A verdict recorded after the fix persists to the Review aggregate and is visible in `px status <slug>` as the round's disposition
- [ ] #5 Tests cover: mapper given a lower round number, mapper given an equal and a higher round number, and verdict recording when the review-state read returns nothing
- [ ] #6 A documented recovery path exists for a mission already left in this state (approved review, unrecorded verdict)
- [ ] #7 `./scripts/verify-local.sh static-analysis` and the affected unit suites pass
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
