---
id: TASK-2262
title: commit handoff NEL record before review-transition rebase
status: review
assignee: [codex]
created_date: '2026-07-14 07:00'
labels: [bug]
dependencies: []
ordinal: 37010
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`performHandoff` captures the mission's `nel-record.json` after the pre-review rebase but
did not commit it. `transitionTask` then rebases the mission worktree onto the
Backlog-owning branch and correctly refuses the uncommitted record, so the handoff stalls
with `Could not transition task ... to review` even though the authoritative Backlog
transition has already been committed.

Stage the NEL record explicitly and commit it before the review transition, deciding
whether it changed from the git index rather than from porcelain output. Fail closed with
a clear message on any git error.

This repair was originally implemented as an addendum under the already-merged task-2237
("enforce local-only development"). It is unrelated to that scope and has been re-homed
here under its own task so it can be reviewed and merged independently.
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
