---
id: TASK-2733
title: make parallix more descriptive in which commands it runs
status: done
assignee: [codex]
created_date: '2026-10-12 13:37'
labels: []
dependencies: []
ordinal: 231008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Example

Everything up-to-date
[✓] External command: bash (0.5s)
[✓] External command: bash (3.0s)
[✓] External command: bash (0.1s)
[✓] External command: bash (41.9s)

Do not add more logging, but explain to the user which command is run instead of the wrapper (bash)
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
