---
id: TASK-2297
title: graphify does not work for codex
status: review
assignee: [custom]
created_date: '2026-07-22 06:44'
labels: []
dependencies: []
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ran sed -n '1,240p' /home/magnus/.agents/skills/graphify/SKILL.md && git status --short && graphify query "task-1107 repro verification gate rebase reviewer handoff"
  └ error: graph file not found: /home/magnus/code/parallix-task-2294/graphify-out/graph.json
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
