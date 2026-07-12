---
id: TASK-2200
title: missing check for label
status: review
assignee: [codex]
created_date: '2026-07-06 15:10'
updated_date: '2026-07-06 15:12'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
[FAIL] Backlog classification: Missing or invalid classification for task-1431; expected exactly one of ai_sdlc, user_value, or unknown in the labels of /home/magnus/code/parallix/backlog/tasks/task-1431 - integration-bugs.md. Fix: add exactly one of those labels and do not use a separate frontmatter field for mission type.

this control should have been updated to be relaxed when the optional bug label was introduced so

-ai_sdlc
-bug

type of label sections are accepted. Its also horribly wrong in that it checks primarybranch instead of the worktree since all changes on label are in the worktree
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
