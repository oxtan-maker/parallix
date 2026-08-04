---
id: TASK-2333
title: when drafting graphify does not work
status: ready-for-integration
assignee: [custom]
created_date: '2026-08-03 05:41'
labels: [ai_sdlc]
dependencies: []
ordinal: 68900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
- Never run HTML viz on a graph with more than 5,000 nodes without warning the user.

codex
I’m using the repository’s Graphify workflow for codebase context; this worktree has no `graphify-out/graph.json`, so there is no graph query to run and I’ll base the contract solely on the supplied backlog report and scaffold.
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
