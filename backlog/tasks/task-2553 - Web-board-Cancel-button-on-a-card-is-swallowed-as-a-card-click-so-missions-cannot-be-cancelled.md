---
id: TASK-2553
title: >-
  Web board: Cancel button on a card is swallowed as a card click, so missions
  cannot be cancelled
status: backlog
assignee: []
created_date: '2026-09-22 10:36'
labels:
  - bug
  - web
  - board
dependencies: []
priority: high
ordinal: 91008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug

On the web operator board, clicking a card's red **Cancel** button no longer opens the cancel confirmation ("Confirm cancelling <id>"). The click seems to register as a click on the card itself (it selects/focuses the card), so the `mission:cancel` action never runs. The operator cannot remove missions from the board and has to fall back to `px cancel <slug> --yes`. Observed 2026-09-22 on `parallix-adhoc-0002` (a refined card in the intake column), which had to be cancelled from the CLI.

## Where to look

- `web/src/intake-column.tsx` and `web/src/flight-column.tsx` render the cancel `ActionButton` inside an `<article>` that is `draggable` and has `onFocus={() => onSelect(card.id)}`. A mousedown on the button focuses the card; the re-render or drag handling may be swallowing the button's click. Unconfirmed hypothesis.
- `web/src/board.tsx`: `onAction` routes `mission:cancel` to `setCancelPrompt` (the two-step confirmation).
- `web/src/action-button.tsx`

## Reproduction

1. `px board --web` (or however the web board is launched) with at least one refined or active mission whose card offers Cancel.
2. Click Cancel.
3. Expected: the confirmation dialog appears. Actual: the card is selected and no dialog appears.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A failing browser-level test (clicking the card's Cancel button opens the cancel confirmation) is written before the fix and passes after it
- [ ] #2 Clicking Cancel on an intake-column card and on a flight-column card opens the confirmation; confirming removes the card
- [ ] #3 Clicking elsewhere on the card still selects it; dragging a card to another lane still works
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
