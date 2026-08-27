---
id: TASK-2418
title: 'Read mission lifecycle from the integration base, not the checkout px runs in'
status: backlog
assignee: []
created_date: '2026-08-26 14:40'
labels:
  - bug
  - user_value
dependencies: []
ordinal: 119917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Running `px ui` or `px status <slug>` from a mission worktree reports other missions' lifecycle state from that worktree's own stale copy of `backlog/tasks/`.

Observed 2026-08-26 from `/home/magnus/code/parallix-task-2402`: task-2411 rendered in the REFINED lane with a `start ▶` affordance, while main (and the task-2411 worktree) had it at `active`. The card was internally inconsistent too — `status: refined` from the stale local file, `rawStatus: review` from task-2411's own worktree.

Root cause is in `ConcreteMissionReadAdapter.buildIntegrationBaseRead` (`src/adapters/backlog/concrete-mission-read-adapter.ts`): the integration-base read resolves to `this.rootDir` for every mission except the one whose worktree you are standing in, so `px` run from a mission branch treats that branch's stale task files as the lifecycle authority. `mission-materialization.ts` documents the intended contract — "`integrationBase` is main (or the recorded feature base)".

A verified fix (developed and then reverted, not committed anywhere):

- Resolve the base root to the primary checkout — `git -C <rootDir> worktree list --porcelain`, first entry — memoized per adapter instance, keeping `resolveBaseWorktree()` for the mission whose worktree is the current root so a recorded non-main base branch still wins. Injectable (e.g. `resolvePrimaryWorktree`) so fixtures do not shell out to the real repository.
- Pick the base task file through the same id-keyed index `loadAllMissions()` already builds, not `resolveTaskFile()` by slug. Slug resolution fails on ambiguous ids — task-2377 currently has a file in both `backlog/tasks/` and `backlog/completed/` — which silently dropped missions that main renders.

With both changes the board built from a mission worktree matched the board built from main lane-for-lane, and the full default suite was green (2170 pass / 0 fail), as were `tsc -p tsconfig.json` and `tsc -p tsconfig.test.json`.

Regression coverage should assert that an adapter rooted at a mission worktree whose local task copy is stale still reports the primary checkout's status, for both `loadAllMissions()` and `loadMission()`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px ui and px status <slug> run from a mission worktree report the same lifecycle status for an unrelated mission as the same command run from the primary checkout
- [ ] #2 A mission whose task id resolves ambiguously across the tasks and completed stores is still projected onto the board when px runs from a mission worktree
- [ ] #3 A test proves an adapter rooted at a mission worktree with a stale local task copy reports the primary checkout's status for both loadAllMissions() and loadMission()
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
