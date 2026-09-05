---
id: TASK-2456
title: handoff retry treats duplicate lane event as failure
status: done
assignee: [claude]
created_date: '2026-09-05 13:55'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`performHandoff` intentionally uses the stable idempotency key
`handoff-${slug}`. A retry after the review transition has committed reaches
`MissionLifecycleService.transition`, which sees the existing review state but
still attempts `saveWithTransition`. SQLite rejects the duplicate lane-event
key and the service reports a conflict, so the otherwise completed handoff
bombs before the backlog state is synchronized.

Treat a duplicate lane event for an idempotent, no-op lifecycle transition as
a successful replay of the already persisted state. Preserve conflicts for
non-idempotent transitions and add a red-to-green reproduction that retries a
handoff after its state transition has committed.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 A repeated handoff after its review transition committed succeeds and synchronizes the Backlog task to review
- [ ] #2 A duplicate key on a non-idempotent lifecycle transition remains a conflict
- [ ] #3 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #4 Lint and static analysis report clean on every changed file
- [ ] #5 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #6 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #7 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
