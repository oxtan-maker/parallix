---
id: TASK-2517
title: Keep integration-gate rebound from stranding a landed mission
status: backlog
assignee: []
created_date: '2026-09-15 09:00'
labels: [bug, ai_sdlc]
dependencies: []
ordinal: 74020
---

## Description

TASK-2513 hit a red `integration-suite` gate during `px integrate`. The TASK-2492 rebound bounced the mission to its implementer through `transitionTaskFn(slug, 'active')`, which moved the SQLite Mission aggregate from `integration` back to `active`. The repair re-ran green, so integrate continued: it pushed the squash commit `93e0b7425` to main, marked Forgejo PR #438 merged, and deleted the remote branch. Only then did `persistLandedIntegrationOrAbort` call `decideIntegration`, which rejected the mission with `Cannot integrate while task-2513 is active; expected integration.`

The operator was left with a shipped change on main, a mission that is not `done`, a retained worktree and local branch, and a Backlog file on the mission branch that no longer matches main. A natural follow-up, `px review --push`, then moved the aggregate to `review` and committed a stale status change on the dead branch. Nothing warns that the work already landed.

Two defects combine into this foot gun:

1. A successful gate rebound does not return the Mission to `integration` before landing, even though the Review decision is unchanged.
2. Integration performs irreversible landing effects (push to main, PR merge, remote branch deletion) before it has proven that lifecycle closeout can succeed.

The status hint also points at `scripts/cleanup-mission-worktree.sh`, which does not exist.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 After a rebound repair re-runs green, the Mission is back in `integration` (at an authoritative timestamp) before any landing effect runs
- [ ] #2 Integration verifies the Mission can accept the integration decision before pushing to main or merging the review PR, and aborts with no remote side effects when it cannot
- [ ] #3 A mission whose squash already landed on the base branch but whose aggregate is `active` or `review` with an approved round can be closed to `done` with non-null `closedAt` through a supported command, and its worktree and branch are cleaned up
- [ ] #4 `px review` and `px active` refuse to run for a mission whose payload has already landed on the base branch, pointing at the closeout command instead
- [ ] #5 The stale-worktree cleanup hint in `px status` names a command that exists
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Regression coverage reproduces rebound-then-land and proves both the pre-landing guard and the closeout recovery
- [ ] #2 Static analysis passes
- [ ] #3 No focused or unannotated skipped tests were introduced
<!-- DOD:END -->
