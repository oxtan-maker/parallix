---
id: TASK-2558
title: improve intergation speed an ux
status: done
assignee: [codex]
created_date: '2026-09-23 06:45'
labels: [ai_sdlc]
dependencies: []
ordinal: 95008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
integration is very slow and chatty. Some parts is bound by CPU, some by GPU, and some by sonarcube cloud pipelines.

Extend parallix infrastructure so integration hook checks can run in parallel, configure parallix to use this infra to speed up integration runs when parallix develops itself.

Fix the ux so the console is divided sensibly when several runs work in parallel so we are nu just mixing 3 runs in the same console linearly, that will be impossible for a human to follow.
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
