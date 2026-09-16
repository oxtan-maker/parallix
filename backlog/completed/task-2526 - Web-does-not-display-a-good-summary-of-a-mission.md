---
id: TASK-2526
title: Web does not display a good summary of a mission
status: done
assignee: [codex]
created_date: '2026-09-16 10:45'
labels:
  - user_value
  - bug
dependencies: []
ordinal: 88007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Instead of something descriptive a lot of the missions on web is just displayed as >-, probably due to some formatting web does not understand, ensure it does
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim (./scripts/verify-local.sh all exit 0, 2631 pass / 0 fail)
- [x] #2 Lint and static analysis report clean on every changed file (static-analysis stage of the gate)
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names (CP-3)
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change (none required: parser bug fix, no authored doc describes the old broken rendering)
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after (test/task-2526-web-summary-repro.test.ts)
<!-- DOD:END -->
