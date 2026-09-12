---
id: TASK-2497
title: Prevent merged missions from remaining active
status: backlog
assignee: []
created_date: '2026-09-12 09:25'
labels:
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A mission can be merged to `main` by an integration process while its separate
mission branch and operator lifecycle record remain `active`. A subsequent
handoff then attempts to rebase and review work that is already landed,
producing conflicts and leaving stale branch/worktree resources.

Make merge detection authoritative during lifecycle transitions. When the
mission payload is already contained in `main`, the workflow must not start a
second handoff or review. It must instead complete the mission lifecycle and
clean up its mission branch and worktree, or report a durable, actionable
recovery state if cleanup cannot safely finish.

Cover the TASK-2492 reproduction: an active mission whose committed payload is
already on `main` must not remain active and must not launch another review.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 A focused regression test covers an active mission already merged to `main`
- [ ] #2 The workflow does not create a duplicate review or handoff for that mission
- [ ] #3 The lifecycle record is closed and branch/worktree cleanup is attempted exactly once
- [ ] #4 Cleanup failure leaves an actionable recovery result without claiming completion
- [ ] #5 Static analysis passes on the final tree
<!-- DOD:END -->
