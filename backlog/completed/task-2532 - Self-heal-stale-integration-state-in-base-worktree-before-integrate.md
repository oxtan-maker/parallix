---
id: TASK-2532
title: >-
  Self-heal stale integration state in the base worktree before integrate
status: done
assignee: [custom]
created_date: '2026-09-17 10:30'
labels:
  - bug
  - ai_sdlc
dependencies:
  - TASK-2530
priority: high
ordinal: 90100
mission_contract: missions/task-2532/MISSION.md
---

## Description

Interrupted `px integrate` runs leave poison in the base (primary) worktree.
The next `px integrate` for a *different* mission then aborts on that stale
state, and its own abort leaves more of it behind. In one incident a mission
was unblocked only by manually dropping a dead stash, aborting a dead
`rebase-merge`, and `git reset --hard`.

Two independent failure modes compound:

1. **Restored-never stash.** Integration stashes the base worktree's unrelated
   dirty changes with the marker
   `integrate:<slug>: temporary integration checkout stash`
   (`stashMainCheckoutIfNeeded`, `src/adapters/cli/commands/integrate-conflict.ts`).
   When an abort fires after the stash is created but before `restoreMainCheckoutStash`
   runs, the stash is never popped and stays in `git stash list` forever. Every
   later integrate sees a dirty base and stashes again — the list grows and the
   next `stash pop` collides with files the landed squash commit already
   committed.

2. **Dead rebase.** When the shared rebase workflow dead-ends mid-replay
   (multi-file conflict, no clean exit), the base worktree is left with a live
   `rebase-merge/` directory, an unmerged index (`git ls-files -u`), and a
   possibly dirty index. The next integrate's preflight bails on unmerged
   entries.

There is no recovery for either: integration assumes the base worktree is clean
at entry and has no idempotent "repair the worktree" step.

## Root cause

Integration resolves the ADR 0043 base branch and immediately stashes + rebases
without first checking whether the base worktree is already in an
integration-owned broken state. The stash marker exists precisely so a stale
stash can be identified and dropped safely; the dead-rebase cleanup exists but
is never run proactively.

## Non-regression constraints (must not break)

- Never drop a stash whose message does **not** match the integration marker
  `integrate:<slug>: temporary integration checkout stash`. Other agents' real
  stashes must be untouched.
- Never `git reset --hard` or `git rebase --abort` outside a base worktree that
  actually contains a live `rebase-merge/` or `rebase-apply/` directory.
- Do not weaken the existing stash/restore pair or the probe-merge conflict
  path (`probeMerge`, `src/application/integrate/landing.ts`).
- Do not touch the agent-smoke gate or `RUN_TIMEOUT_MS`; the local-model
  timeout gate is operator env, out of scope.

## Acceptance Criteria

- [ ] #1 An interrupted integrate that left a marker-tagged stash in the base
  worktree no longer blocks a later integrate for a different mission: the
  stale marker stash is dropped and integration proceeds.
- [ ] #2 An interrupted integrate that left a live `rebase-merge/` or
  `rebase-apply/` directory plus an unmerged index in the base worktree is
  repaired on the next integrate (rebase aborted, index cleared) and
  integration proceeds without the "unmerged entries" preflight failure.
- [ ] #3 A stash whose marker does not match the integration marker is never
  dropped by this sweep.
- [ ] #4 A base worktree that is already clean is unaffected (no stash created,
  no reset, no rebase).
- [ ] #5 Recovery runs **before** the stash/rebase steps, at the single
  integration entry chokepoint, not in a per-mission branch.

## Definition of Done

- [ ] #1 Verification gate ran and passed on the final tree with captured proof
  rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests introduced (no .only, no bare
  .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line
  references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that
  fails before the fix and passes after

## Implementation guidance (minimal)

Add a single preflight step at the top of the integration workflow
(`src/application/integrate-workflow.ts`, before the stash/rebase steps) that
scans the resolved base worktree for and safely removes integration-owned
poison:

- integration-marked stashes (message matches
  `integrate:<slug>: temporary integration checkout stash`) → `git stash drop`.
  Reuse the marker string from `stashMainCheckoutIfNeeded` so the sweep and the
  push agree on the identifier.
- a live `rebase-merge/` or `rebase-apply/` directory → `git rebase --abort`
  then `git reset --hard HEAD`, only when the directory is present.

Keep it read-only-to-safety: only ever act on integration-owned markers, and
only in the resolved base worktree.
