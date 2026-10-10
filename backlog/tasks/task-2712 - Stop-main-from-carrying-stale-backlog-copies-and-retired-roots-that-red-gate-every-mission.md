---
id: TASK-2712
title: >-
  Stop main from carrying stale backlog copies and retired roots that red-gate
  every mission
status: backlog
assignee: []
created_date: '2026-10-10 09:13'
labels:
  - ai_sdlc
  - bug
dependencies: []
priority: high
ordinal: 214008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Incident: mission task-2709 repair incident aad389cc (CP-5, verify-local all) failed and px died on baseline-red guards inherited from main, unrelated to the mission. Failures: (1) test/unit/adapters/backlog/backlog-completed-task-consistency.test.ts — main still carried backlog/tasks/task-2691 (also in backlog/completed); landing should drop stale copies. (2) mission-directory-free-workflow.test.ts — retired backlog/archive root present on main. (3) prompt-split.test.ts — test/fixtures/prompt-split-parent.json not regenerated after a draft-core prompt line was added. The mission repaired these in commit 2f417e55d1. Goal: make it not recur — landing/integrate must drop stale backlog/tasks copies and never land files under backlog/archive; prompt edits that change draft-core must regenerate the fixture (or the gate must fail at the prompt-changing mission, not a later one); main must be verified green by the pre-integration gate so later missions do not inherit red.
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
