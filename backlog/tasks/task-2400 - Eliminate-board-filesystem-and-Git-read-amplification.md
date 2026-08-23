---
id: TASK-2400
title: Eliminate board filesystem and Git read amplification
status: backlog
assignee: []
created_date: '2026-08-23 07:24'
labels: []
dependencies: []
ordinal: 110917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

The interactive board currently rebuilds frequently and does far too much repeated filesystem and Git work while doing so. Fix the board read path so repository topology and task metadata are read once per projection where possible rather than rediscovered independently for every mission.

Two related defects belong in this mission because they meet in the same mission-read path and should be solved coherently:

1. Worktree topology is repeatedly rediscovered per mission. `ConcreteMissionReadAdapter` resolves worktrees while materialising individual missions and `ConcreteGateReadAdapter` independently resolves the same worktrees. `resolveWorktree()` itself shells out to `git worktree list --porcelain`, causing subprocess count to grow with mission count.

   A board projection must obtain one immutable worktree-topology snapshot and reuse it for normal mission materialisation and gate lookup. The number of `git worktree list` subprocesses caused by those projection readers must be O(1) with respect to mission count.

   Do NOT change running-agent detection in this mission. `detectRunningMissionSessions`, its `ps` scan, its own worktree observation, `currentWork`, session markers, process liveness and all fallback semantics must remain behaviorally untouched. That mechanism is intentionally retained until it is trusted. It may therefore account for an additional constant worktree-list operation; the requirement is to eliminate per-mission worktree subprocesses, not to consolidate authorities.

2. Backlog task documents are repeatedly reopened to read id, status, assignee, title, labels, closedAt and related metadata. Bulk projection materialisation should read each distinct task Markdown document once and parse/extract the required metadata from that snapshot rather than calling small helpers which each reread the whole file.

   Do not create another durable metadata cache or duplicate task authority. This is per-read/per-build materialisation only.

Archive is cold storage and must not be part of the normal Parallix board projection. `loadAllMissions()` must enumerate `backlog/tasks/` and `backlog/completed/`, but it must NOT scan or materialise `backlog/archive/`.

Do not implement archival policy here. Moving old completed missions into archive is owned by backlog.md and is explicitly out of scope. Do not attempt to repair backlog.md, retention rules, completed-task ageing or archive mutations in this mission.

Preserve board semantics and all existing task/worktree precedence rules for the stores that remain in scope.

Add regression tests that count filesystem reads and Git-worktree-list invocations so this cannot regress back to N-per-mission behavior. Test with enough missions that a fake constant implementation cannot accidentally pass.

Avoid introducing a daemon, filesystem watcher, event bus, persistent projection cache, new durable authority or generic caching framework. The desired design is deliberately simple: read repository topology once, read each task document once, build the projection from those snapshots.

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
