---
id: TASK-2447
title: Expose complete mission card facts to the web board
status: done
assignee: [custom]
created_date: '2026-08-30 15:06'
labels:
  - bug
  - user_value
  - web
  - backend
  - projection
dependencies: []
priority: high
ordinal: 124917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The shared MissionCard projection contains checkpoint history, pull-request reference, review approval, and review history. The web transport currently forwards only the latest checkpoint text and current review round, so the browser cannot truthfully render the reference checkpoint indicators, PR link, or review-round meter. Ink reads the richer shared MissionCard directly, which makes the two UIs disagree despite the same board projection. Extend the versioned web transport with the existing server-owned facts and validate the round trip; do not derive limits, links, or checkpoint state in React.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The web snapshot carries the checkpoint facts required to render the card indicators without client-side lifecycle inference.
- [ ] #2 The web snapshot carries the pull-request reference and review facts required for the PR link and review display.
- [ ] #3 Transport conversion and validation preserve the fields and reject malformed payloads.
- [ ] #4 The web board renders received indicators and link data without invented values.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 Focused transport and web-render tests pass.
- [ ] #8 Static-analysis passes.
<!-- DOD:END -->
