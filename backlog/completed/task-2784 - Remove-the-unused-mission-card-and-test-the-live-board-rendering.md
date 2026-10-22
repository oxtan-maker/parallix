---
id: TASK-2784
title: Remove the unused mission card and test the live board rendering
status: done
assignee: [codex]
created_date: '2026-10-19 09:55'
labels: []
dependencies: []
ordinal: 265008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Retire web/src/mission-card.tsx and its test-only MissionCardView path. Keep the actual Board and FlightColumn rendering as the browser presentation owner.

Context:
Read ADRs 0051, 0054 and 0055, including TASK-2447's card-facts amendment and TASK-2437's board cutover. Preserve later TASK-2750 and TASK-2769 activity/command-state behavior.

Success criteria:

1. Inspect the three web-mission-card-render cases and move every still-required product assertion into the existing tests of the actual Board and its rendered children.
2. Preserve the current browser contract for mission identity, checkpoint evidence, review state, PR links, activity and command availability. Resolve differences using the landed product requirements rather than copying the retired component's labels.
3. Delete MissionCardView and its redundant cases/imports. Production and tests use the same real rendering path; no replacement test-only component is introduced.
4. Run focused browser presentation tests and manually inspect representative mission cards with disposable data. Keep TUI rendering and unrelated board design outside this cleanup.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
