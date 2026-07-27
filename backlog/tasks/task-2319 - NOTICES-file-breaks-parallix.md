---
id: TASK-2319
title: NOTICES file breaks parallix
status: refined
assignee: [codex]
created_date: '2026-07-27 08:16'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
there is a NOTICES file being generated all the time the breaks parallix flow

[INFO] ========== Round 1 / 5 ==========
[FAIL] Cannot auto-commit: dirty files include non-mission paths:
       - NOTICES
[WARN] Worktree is
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
