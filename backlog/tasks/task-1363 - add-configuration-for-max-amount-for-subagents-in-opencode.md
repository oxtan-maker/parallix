---
id: TASK-1363
title: add configuration for max amount for subagents in opencode
status: refined
assignee: [custom]
created_date: '2026-06-27 07:16'
labels: ["ai_sdlc"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
opencode agent does not have any way of limiting the amount of subagents. Add this to the parallix harness (i.e. configuration for max # of subagents. Since opencode does not have this option, we have to implement it in prompt prefixing/postfixing. Implement ther general code for using parallix to develop something else (default to not add to prompt).

Then set the config to max parallel subagents to 2 for opencode when parllix is used to develop itself.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #3 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #4 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #5 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
