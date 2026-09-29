---
id: TASK-2614
title: local autoinstall stopped working
status: backlog
assignee: []
created_date: '2026-09-29 10:50'
labels: []
dependencies: []
ordinal: 142008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
current locally installed px is much older than repo version, local autoinstall after succesful integration stopped working. Restore it, just do a px --version vs npm run dev -- --version to identify the regression point (most likely a mission that overinterpreted its scope). Do not destroy the mission that caused the breakage though, just fix the side-effect.
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
