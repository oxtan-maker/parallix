---
id: TASK-2565
title: >-
  Mission lifecycle is written from Backlog.md and read from a frozen Backlog
  copy, against ADR 0053
status: done
assignee: [codex]
created_date: '2026-09-23 13:16'
labels:
  - workflow
  - persistence
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 100008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR 0053 makes SQLite-backed Mission state the sole authority for lifecycle (Authority boundaries table: 'Mission identity, title, labels, assignee, lifecycle and closure | SQLite-backed Mission state'). It also says: 'Application use cases decide transitions. Persistence records their result. Interfaces, adapters, and agents do not acquire lifecycle authority by directly mutating SQL.' Backlog.md is a task source that mirrors the lifecycle; it is not the lifecycle. Three places break this. An adhoc mission has no Backlog.md task at all, so anything that reads lifecycle from Backlog, or from a copy of it, is wrong for adhoc missions.

## 1. A Backlog task write sets missions.status directly

`reconcileExternalMissionLifecycle` in src/adapters/backlog/task-transitions.ts runs after every successful `transitionTask` and calls `store.save({ ...mission, status })` with the status parsed from the Backlog write. The direction is backwards (Backlog to authority), it skips the domain transition rules in src/domain/mission-workflow.ts, and it writes no board_lane_events row. Its comment calls SQLite 'an optional projection'.

Observed on task-2547 (operator DB, 2026-09-21): the lane events go review→integration (approve) three times, with no event leaving integration in between. The integration-gate rebound calls `transitionTask(slug, 'active')` (src/application/integrate/gates.ts) to hand the repair to the implementer, and that moved the Mission from integration to active through this write-back. Integrate then found an active Mission holding an approved round and refused with 'stored approval without the required provider approval'.

The real-agent smoke exposed the same gap on a completed typed mission: the Mission reached `done`, but its lane history skipped `refined→active` and included `done→done`. Restore a lane-history assertion in that end-to-end test when this lifecycle write path is fixed, so the bug cannot recur unnoticed.

## 2. px status reports a frozen intake copy as 'Backlog status'

`missions.raw_status` is the Backlog status string captured at intake and never updated; nothing writes it after intake. `px status` prints it as 'Backlog status' (src/adapters/cli/commands/status-adapter.ts, `backlogStatus: card.rawStatus ?? card.status`). Every refined or active mission in the operator DB shows raw_status 'backlog' (task-2561 is active at status='active', raw_status='backlog'). For an adhoc mission, draft intake hard-codes rawStatus 'backlog' (src/adapters/cli/commands/draft-stats.ts intake), so status reports a Backlog state for a task that does not exist. The web board reads `card.lane` from missions.status and is correct, so the two surfaces disagree.

## 3. A running draft is published as execution

`DraftCommandUseCase` publishes its current work with `phase: 'execute'` (src/application/draft-command-use-case.ts), and `CurrentWorkPhase` (src/application/recording/current-work-recorder.ts) has no draft phase. While a draft runs, every current-work reader shows the mission as executing; when the draft ends it reads refined again. Observed on task-2522, 2026-09-23 08:39-08:48: the operator saw it apparently move back to refined, although its lane history is only intake→backlog and refine. The 2026-09-16 draft of task-2522 recorded 'running' and never 'ended' (its process died), which leaves a stale running fact.

## Direction

Lifecycle changes go only through the Mission lifecycle service (domain decision + lane event), and the Backlog task is written afterwards as a mirror, never the reverse. Surfaces read lifecycle from missions.status. raw_status is either removed from lifecycle display or dropped. Draft gets its own current-work phase.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Backlog task status write never changes missions.status; lifecycle changes happen only through the Mission lifecycle transition, and each writes a lane event
- [ ] #2 Every caller that relied on the write-back (at least the integration-gate rebound's transitionTask(slug, 'active')) transitions the Mission through the lifecycle service instead, or the lifecycle it needs is modelled in the domain
- [ ] #3 px status reports the Mission lifecycle status from missions.status, and never shows a Backlog state for an adhoc mission that has no Backlog task
- [ ] #4 A running px draft publishes a draft current-work phase, not execute, and the board and status show it as drafting
- [ ] #5 A reproduction test covers the task-2547 shape: an integration-gate rebound leaves no Mission status change without a matching lane event
- [ ] #6 The real-agent smoke asserts the completed Mission's lane history includes each transition from backlog through done, with no same-status `done→done` event
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
