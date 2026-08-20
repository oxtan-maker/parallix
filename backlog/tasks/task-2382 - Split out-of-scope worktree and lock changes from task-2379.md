---
id: TASK-2382
title: Split out-of-scope worktree and lock changes from task-2379
status: backlog
assignee: []
created_date: '2026-08-19 00:00'
labels:
  - ai_sdlc
priority: medium
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review round 1 of TASK-2379 (finding F4, low, non-blocking) flagged two committed changes that are not covered by the mission's Scope list: `src/adapters/git/worktree.ts` (`workTreeRootFor` / `resolveWorktree` normalization, commit d9d0db74c) and the `package-lock.json` version sync (commit ada2c7388).

Both were motivated by the mission agent's own environment repair: this checkout's git dir is named `.git-worktree` (a read-only-host workaround), so `git worktree list --porcelain` reports the git dir itself as the main worktree path and `resolveWorktree` hands that path to the rebase workflow, failing with "this operation must be run in a work tree". Until the change is split or a named criterion covers it, the change rides into the TASK-2379 integration even though no Success Criterion covers it.

Split both changes into their own tracked change (or amend the TASK-2379 checkpoint evidence to state explicitly why they are required and cover the worktree change under a named criterion). Note: reverting the worktree change while the `.git-worktree` gitdir naming is in place breaks `resolveWorktree` for that checkout, so the split must not leave the mission branch unable to run its own verification gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Either the `resolveWorktree` normalization and the `package-lock.json` sync are committed as their own change with their own mission/checkpoint evidence, or a TASK-2379 checkpoint states explicitly why they are required by that mission
- [ ] #2 `test/mission-utils-worktree.test.ts` "resolveWorktree walks up when git reports the git dir as the main worktree path" continues to pass on the final tree
- [ ] #3 `./scripts/verify-local.sh all` passes
<!-- AC:END -->

## Out of Scope

- Renaming the `.git-worktree` git dir or repairing the host filesystem
- Changing rebase workflow behavior beyond what `resolveWorktree` feeds it

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
<!-- DOD:END -->
