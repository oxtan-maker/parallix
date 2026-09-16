---
id: TASK-2516
title: Recover landed missions missing durable lifecycle state
status: done
assignee: [codex]
created_date: '2026-09-15'
labels: [bug, integration, lifecycle, ai_sdlc]
dependencies: []
priority: high
ordinal: 74015
---

## Description

Some locally landed missions can have a completed Backlog artifact and a squash commit on `main` while the authoritative Mission aggregate is absent. The mission then remains as a stale worktree, and `px status <slug>` cannot report its durable completion state.

Provide a safe, idempotent recovery path that reconstructs or closes only an already-landed mission from durable Git evidence. It must not create a completion for an unlanded branch or let a Forgejo PR state decide merge authority.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 An already-landed mission with a completed task artifact and no Mission aggregate can be recovered to closed/done exactly once
- [ ] #2 `px status <slug>` reports the recovered durable lifecycle state
- [ ] #3 Recovery removes the stale worktree and branch only after durable closeout succeeds
- [ ] #4 Recovery refuses a mission whose payload has not landed on its recorded base branch
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Regression coverage proves both recovery and refusal paths
- [ ] #2 Static analysis passes
<!-- DOD:END -->
