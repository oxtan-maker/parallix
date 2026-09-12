---
id: TASK-2496
title: wrong warning
status: backlog
assignee: []
created_date: '2026-09-11 13:01'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
when starting drafting (before the agent has set the classification) we warn about missing classification. Example: 

magnus@debian:~/code/parallix$ npm run dev -- draft task-2494

> @magnusekdahl/parallix@1.5.104 dev
> tsx src/entry/px.ts draft task-2494

Drafting mission task-2494
  branch    mission/task-2494
  worktree  /home/magnus/code/parallix-task-2494
[FAIL] Missing or invalid classification for task-2494; expected exactly one of ai_sdlc, user_value, or unknown in the labels of /home/magnus/code/parallix-task-2494/backlog/tasks/task-2494 - Fix-agent-fallback-after-usage-blocks-during-rebase-handoff.md. Fix: add exactly one of those labels and do not use a separate frontmatter field for mission type.
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
