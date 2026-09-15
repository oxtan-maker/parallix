---
id: TASK-2515
title: Lead attention queue ignores persisted integration lifecycle when backlog task is completed
status: done
assignee: [custom]
created_date: '2026-09-14'
labels:
  - bug
  - ai_sdlc
dependencies: []
ordinal: 74014
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px lead` does not wake a recovery agent for task-2508 even though the
mission's SQLite `Mission` aggregate is stuck in `integration` and its retained
worktree needs repair.

The primary checkout contains task-2508 only in `backlog/completed/`, where its
task Markdown says `status: done`. The mission read adapter loads that completed
task record and maps its raw backlog status into the materialized mission. The
board then derives the lane from that materialized `mission.status`, so the
completed Markdown record masks the authoritative persisted lifecycle
(`integration`). The board therefore never emits an `integrate-lane` attention
item, and `px lead` has no item on which to run its recovery flow.

Fix the projection boundary so the attention queue consumes the same
DB-backed Mission projection as the rest of the board. A persisted Mission
lifecycle in `integration` or another non-terminal state must not be hidden by
a stale/completed backlog task record. Preserve the existing rule that `px
lead` does not perform the human-owned integration action; once the shared
lifecycle projection is correct, the queue must expose the item to the normal
operator/recovery path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 A mission persisted as `integration` remains in the board's integration lane even when its backlog task file is in `backlog/completed/` with `status: done`.
- [ ] #2 The board attention queue contains that mission with the existing `integrate-lane` reason and `integrate:merge` action.
- [ ] #3 The attention queue and board cards read the lifecycle from one shared DB-backed projection; no queue-only backlog-status reconstruction remains.
- [ ] #4 `px lead --once` observes the mission in the queue and records the human handoff instead of silently omitting it; no automatic integration is performed.
- [ ] #5 Regression coverage reproduces task-2508's completed-Markdown/stuck-SQLite lifecycle combination and fails on the parent commit.
- [ ] #6 `./scripts/verify-local.sh all` passes with no focused or unannotated skipped tests.
<!-- AC:END -->

## Scope

- Trace and repair the mission-read/board-projection authority boundary that
  currently lets completed task Markdown override a non-terminal persisted
  Mission lifecycle.
- Add the smallest regression test at the projection/lead boundary.
- Verify the lead queue and human-only integration behavior together.

## Out of Scope

- Automatically running `px integrate` or changing the human-only integration
  safety rule.
- Changing Forgejo merge state, integration closeout behavior, or backlog task
  promotion rules.
- New persistence tables or a second lifecycle authority.

## Verification

- `./scripts/verify-local.sh all`
<!-- SECTION:NOTES:BEGIN -->
<!-- SECTION:NOTES:END -->
