---
id: TASK-2237
title: make parallix local only development
status: backlog
assignee: [codex]
created_date: '2026-07-12 14:23'
labels: [user_value]
dependencies: []
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
parallix should be local only development. Still I see recent pushes on mission branches.

Remove and delet history or those branches if possible in github. Ensure that all code that pushes to github is removed. Note that pushes to foregjo is not remote since forgejo is supposed to be running local on docker, it just might seem that way to an agent.

If there is no code that does this, update agent instructions and if possible set hard git limits so only main can be pushed to github going forward.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [X] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [X] #2 Lint and static analysis report clean on every changed file
- [X] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [X] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [X] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
