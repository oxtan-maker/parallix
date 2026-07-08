---
id: TASK-2202
title: parallix autocommit seems to exclude some files
status: done
assignee: [codex]
created_date: '2026-07-07 16:33'
labels:
  - ai_sdlc
  - bug
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an agent exits the `active` step with real implementation changes still uncommitted, I expect the workflow harness to finish the mechanical git work instead of rejecting the handoff because the dirty files are outside the current mission-artifact allowlist. Today `repairHandoff()` auto-commits `missions/<slug>/`, backlog task files, and a few workflow-generated paths, but it refuses ordinary implementation paths such as `lib/`, `test/`, or other repo files that belong to the mission worktree. That turns a recoverable weak-agent miss into a blocked workflow.
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
