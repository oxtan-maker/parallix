---
id: TASK-2429
title: Integrate merge through the guarded board command boundary
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - board
  - integration
  - controller
  - high-risk
dependencies:
  - TASK-2428
priority: high
---

## Description

Make `integrate:merge` executable through the typed board controller by reusing the existing integration application workflow. This is a destructive/high-risk operation and must stay fail-closed.

The board request identifies the mission/action only. It must not accept `--force`, gate-skipping flags, branch names, target refs, shell fragments, repository paths, or arbitrary options. Current authoritative mission/review state and the integration workflow determine whether a merge is legal.

## Acceptance Criteria

- [ ] #1 `integrate:merge` dispatches through the existing integration use case/workflow, not a new Git implementation or subprocess of `px integrate`.
- [ ] #2 The authoritative stale/precondition guard from TASK-2425 runs before integration is accepted.
- [ ] #3 Integration remains allowed only where current lifecycle/review policy allows it, including reviewed-revision/approval constraints already enforced by Parallix.
- [ ] #4 Browser/board callers cannot request force, skip gates, select a branch/remote, or alter cleanup behavior.
- [ ] #5 Failed gates/merge/conflict return failure and the mission is not projected as done.
- [ ] #6 Successful integration changes the board only when the next authoritative projection reports the completed state.
- [ ] #7 Existing CLI `px integrate` behavior remains unchanged.

## Agent-slop guardrails

- No direct `git merge`, branch deletion, worktree deletion, or Forgejo calls from the board controller/interface.
- No “fallback” state transition if integration fails.
- No client-supplied current status/review approval.
- No test that asserts only a success message; assert effect ordering and failure non-transition through mocked ports/domain state.

## Definition of Done

- [ ] #1 Unit tests cover allowed, stale, gate-failed and unavailable cases without real external services.
- [ ] #2 Existing integration characterization tests remain green.
- [ ] #3 Verification/static-analysis gates pass.
- [ ] #4 Reviewer explicitly checks destructive-effect containment and absence of force/bypass input.
