---
id: TASK-2438
title: parallix ui does not detect changes in worktrees
status: backlog
assignee: [codex]
created_date: '2026-08-28 05:59'
labels:
  - user_value
  - bug
dependencies: []
ordinal: 123917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px ui only shows task 2373.01 in active or later stages, but we have a lot more missions there. Fix the bug so everyh mission that is working in parallel is detected in its correct state regardless of where px ui is started (as long as its started from the right repo)

2026-08-30 regression: the fix is incomplete. `composeBoardProjection()` reads
the repository-scoped SQLite aggregates, but then retains only IDs found in
the current checkout's Markdown catalog. A mission that exists only in another
live worktree is therefore still absent from both Ink and web. The existing
TASK-2438 repro is not representative because it writes every persisted ID
into both fixture roots; add a red test where an active persisted mission is
present only in the other worktree, then make the shared board catalog include
it without reviving archived records.
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
