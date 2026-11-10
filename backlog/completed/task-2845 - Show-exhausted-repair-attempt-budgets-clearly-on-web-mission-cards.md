---
id: TASK-2845
title: Show exhausted repair-attempt budgets clearly on web mission cards
status: done
assignee: [codex]
created_date: '2026-11-07 08:35'
labels:
  - bug
  - web
  - ux
dependencies: []
references:
  - web/src/flight-column.tsx
  - src/application/review-round-use-case.ts
  - src/application/projections/mission-board.ts
priority: medium
ordinal: 310016
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mission cards currently conflate a persisted review round with an autonomous attempt limit. For px-0031, valid review round 6 was rendered as ‘review round unknown’ while the actionable state was that the retained repair-attempt budget had been spent. Project the durable repair-budget facts and show that exhausted state directly without hiding valid review history. Do not change retry or repair policy.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A valid persisted review round, including round 6 and later continuation windows, is rendered as its actual round and is never labeled unknown merely because it exceeds a local UI constant.
- [ ] #2 The server transport exposes typed durable repair-budget state sufficient for the client to render attempts used, maximum attempts, and whether the budget is exhausted; the client does not infer this from reviewRound.
- [ ] #3 The mission card visibly distinguishes review history, autonomous review-window allowance, and retained pre-review/integration repair-attempt budget.
- [ ] #4 When the repair budget is exhausted, the card shows an explicit spent state such as ‘repair attempts spent (2/2)’ and an actionable recovery/resume cue.
- [ ] #5 The owning tests reproduce the px-0031 shape—review round 6 with an exhausted repair budget—and cover later valid continuation rounds.
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
