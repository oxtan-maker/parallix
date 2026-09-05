---
id: TASK-2454
title: web board cannot start drafting
status: done
assignee: [claude]
created_date: '2026-09-05 04:50'
labels:
  - ai_sdlc
  - bug
dependencies: []
ordinal: 124917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
when you push the draft button you just get error message (from parallix main repo as it should be)

REFINED
0
no missions in this stage

BACKLOG
4

ACTIVE
2 cards
1 spinning · 1 stopped
task-2437.01
working · live
●
codex
Design-fidelity audit of the web board against the reference design

●
handing off and reviewing
recovery evidence: coordinator live (codex)

activate

REVIEW
0 cards
no missions in this stage

INTEGRATION
0 cards
no missions in this stage

◂
DONE · 2
mission authority could not find the mission

check how the draft works and how the backend should work when its executed from any worktree or the main dir/branch so it can handle those cases (including subcommands working in the correct dirs)
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
