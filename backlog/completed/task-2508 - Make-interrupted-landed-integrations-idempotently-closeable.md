---
id: TASK-2508
title: Make interrupted landed integrations idempotently closeable
status: done
assignee: [codex]
created_date: '2026-09-14 12:00'
labels: [bug, ai_sdlc]
dependencies: []
ordinal: 74007
---

## Description

TASK-2502 landed its squash commit on main and Forgejo marked its review PR merged, but integration stopped before the SQLite Mission aggregate was transitioned from `integration` to `done` and before worktree cleanup. A retry then fails at Forgejo's merged-PR preflight, so it cannot reach the existing local-squash recovery path. The operator is left with a shipped task, a stranded lifecycle record, and a retained mission worktree.

Make already-landed local squash commits an idempotent closeout path: persist the completion and closure records exactly once, clean up the mission worktree, and report the durable lifecycle status. Do not treat Forgejo merge state as merge authority.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 A mission interrupted after its local squash lands but before closeout can be retried to `done` with a non-null `closedAt`
- [ ] #2 A merged Forgejo PR does not block that local, already-landed closeout path
- [ ] #3 Successful resumed closeout removes the mission worktree and branch exactly once
- [ ] #4 `px status` reports the authoritative lifecycle status rather than stale raw backlog status
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Regression coverage reproduces the interrupted landed-integration state and proves idempotent closeout
- [ ] #2 Static analysis passes
- [ ] #3 No focused or unannotated skipped tests were introduced
<!-- DOD:END -->
