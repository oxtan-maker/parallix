---
id: TASK-2572
title: Keep imported task source reachable after squash integration
status: backlog
assignee: []
created_date: '2026-09-24 20:24'
labels:
  - bug
  - workflow
dependencies: []
priority: high
ordinal: 105008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The legacy importer stores ExternalTaskRef URLs pinned to the mission branch HEAD. Mission branches are squash merged, so that commit is not an ancestor of main and can become unreachable after branch cleanup and Git garbage collection. TASK-2521.06 retained its 553 canonical bodies in a committed migration artifact as a one-shot safeguard, but the generic import path still creates branch-only references. Make future accepted external task material durable through a main-reachable commit or a committed artifact before deleting source files.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After squash integration, branch deletion, and removal of the source task file, px status still returns the full verified task body without depending on the discarded branch commit.
- [ ] #2 An importer run fails closed when its claimed source cannot be retained and verified through the integration path.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
