---
id: TASK-2592
title: ensure we always autocommit
status: backlog
assignee: []
created_date: '2026-09-27 14:28'
labels: []
dependencies: []
ordinal: 123008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
there seem to be legacy rules in parllix, we should always autocommit if agents forget, example [WARN] Repository verification passed, but its reusable proof is unavailable (verification proof cannot reuse a dirty worktree).
[FAIL] [FAIL] Cannot auto-commit: dirty files include non-mission paths:
[FAIL]        - test/lifecycle-timing.test.ts
[FAIL] [WARN] Worktree is dirty with unsafe or conflicted files. Rebase may fail.
[FAIL] Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch.
[FAIL] Handoff failed for mission/task-2582: Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch..
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
