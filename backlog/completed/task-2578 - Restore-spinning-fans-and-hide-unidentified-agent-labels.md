---
id: TASK-2578
title: Restore spinning fans and hide unidentified agent labels
status: done
assignee: [codex]
created_date: '2026-09-26 05:44'
labels:
  - ai_sdlc
  - bug
  - web
dependencies: []
priority: high
ordinal: 109008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The original request was to remove the blinking "no implementer" display when
the web board cannot identify an agent. TASK-2576 left that label in place and
also stopped fans that previously showed work in progress.

Restore the fan behavior from before TASK-2576: live and unverified current work
spin the fans; stale or absent work does not. Hide the agent label and its dot
when no agent is identified. Keep known agent labels and existing unrelated fixes.

Use Git history and failing regression checks to establish the cause. Do not
replace the existing activity model or expand this into terminal dashboard work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Restore the pre-TASK-2576 fan behavior, including work with no identified agent or observed coordinator.
- [x] #2 Remove "no implementer" and its activity dot when the agent is unidentified.
- [x] #3 Preserve known agent labels, stale/idle fan stopping, and reduced-motion support.
- [x] #4 Record the first bad commit and its mission/recorded implementer with a historical comparison.
- [x] #5 Regression checks fail on the broken behavior and pass after restoration.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
