---
id: TASK-2358
title: >-
  Board review projection discards all prior review rounds, so px status and the
  TUI report only the current round
status: backlog
assignee: [custom]
created_date: '2026-08-10 00:00'
labels:
  - bug
  - review
  - board-projection
dependencies: []
references:
  - src/adapters/backlog/concrete-review-read-adapter.ts
  - src/adapters/sqlite/mission-store.ts
  - src/application/projections/mission-board.ts
  - backlog/tasks/task-2332.13 (review rounds 2-9 reported this repeatedly)
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px status <slug>` and the TUI report only the current review round. Every
prior round's reviewer/implementer families, verdict, findings, fixes, and
pushbacks are absent, even though the operator database holds all of them.
This blocks reviewers from determining whether a finding was already settled
in an earlier round, and it was raised as a review finding on nine consecutive
rounds of TASK-2332.13 without an owner.

### Root cause

The data is persisted correctly and every read layer above the adapter is
correct. The loss happens in exactly one place.

Persisted state is complete. For `task-2332.13`, `mission_review_rounds` holds
9 rows with distinct `round_number`, `reviewer`, `implementer`, `phase`, and
`disposition` values, and `src/adapters/sqlite/mission-store.ts:169` loads all
of them (`FROM mission_review_rounds WHERE mission_id = ? ORDER BY position`).

The board's review reader throws that away.
`ConcreteReviewReadAdapter.toDomainReview()`
(`src/adapters/backlog/concrete-review-read-adapter.ts:142-186`) does not read
`mission_review_rounds` at all. It reads the flat `ReviewState` compatibility
artifact via `readReviewState()`, synthesises a single `ReviewRound` from that
one flat record, and returns `rounds: [round] as [ReviewRound, ...ReviewRound[]]`
(line 172). It also hardcodes `reviewEvents: []` (line 177), so the persisted
review-event stream is dropped by the same method.

Two consequences follow from that one line:

1. `projectReviewHistory()` (`src/application/projections/mission-board.ts:105-124`)
   correctly maps *all* `review.rounds`, but is handed a one-element array.
2. Every consumer therefore renders one round: `src/interfaces/cli/status.ts:51`,
   `src/adapters/cli/commands/status.ts:270`, and the TUI mission detail view.

The flat `ReviewState` is the compatibility artifact, not the authority — the
operator database is. This adapter has the authority relationship inverted: it
is the board's only review reader, and it reads the lagging artifact.

### Scope note

This is not a rendering or CLI bug. `projectReviewHistory`, the status use
case, the status CLI renderer, and the TUI all handle multi-round history
correctly today and need no change. The fix belongs entirely in the review
read adapter and its composition.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 `ConcreteReviewReadAdapter.loadReview()` returns one `ReviewRound` per persisted row in `mission_review_rounds`, ordered by `position`, instead of a single synthesised round
- [ ] #2 Each returned round carries the persisted `round_number`, `reviewer`, `implementer`, `phase`, and `disposition` for that row, not the current round's values repeated
- [ ] #3 Each returned round carries its persisted findings from `mission_review_findings` and its resolutions from `mission_review_resolutions`, so `projectReviewHistory` populates `findingSummaries`, `fixes`, and `pushbacks` for prior rounds
- [ ] #4 `reviewEvents` is populated from `mission_review_events` rather than hardcoded to `[]`
- [ ] #5 `px status <slug>` on a mission with N persisted rounds prints N `Round <n> [<reviewer> -> <implementer>]: <disposition>` lines, verified against a fixture with at least 3 rounds having distinct reviewer/implementer/disposition values
- [ ] #6 When the operator database has no rounds for a mission, the adapter still degrades to the flat `ReviewState` single-round behavior rather than returning null, so missions predating round persistence keep rendering
- [ ] #7 A regression test asserts that a 3-round fixture does not collapse to 1 round; the test fails on the pre-fix tree
<!-- AC:END -->

## Implementation Plan

1. Add a rounds-reading path to `ConcreteReviewReadAdapter` that queries the
   mission store for all persisted rounds rather than calling `readReviewState`
   for the round list.
2. Join findings and resolutions per round position so prior-round findings,
   fixes, and pushbacks survive into the domain `Review`.
3. Populate `reviewEvents` from the persisted event stream.
4. Keep the flat-`ReviewState` construction as the fallback for missions with
   no persisted rounds (AC #6).
5. Add the 3-round regression fixture (AC #7) and confirm it fails before the
   change.
6. Run the static-analysis gate on every changed file.

## NEL Estimate

Medium (80–240 NEL): one adapter rewritten against an existing store query,
plus findings/resolutions joins and a fixture. No schema change — the rows
already exist.

## Agent-completeness guardrails

- Do not "fix" this in `projectReviewHistory`, `src/interfaces/cli/status.ts`,
  or the TUI. Those layers already handle N rounds; a change there would mask
  the adapter defect rather than fix it.
- Verify against a real multi-round mission, not only a unit fixture. Confirm
  the persisted row count first, then assert `px status` prints the same
  number of round lines.
- AC #6 is a real requirement, not a nicety: missions whose rounds predate
  round persistence must not start rendering "Review: not started".
- Stop for human direction if populating rounds requires a schema migration
  (current assessment says it does not — `mission_review_rounds`,
  `mission_review_findings`, `mission_review_resolutions`, and
  `mission_review_events` all already carry the needed columns).

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
