---
id: TASK-2471
title: Improve px draft default terminal output
status: backlog
assignee: []
created_date: '2026-09-09 11:10'
labels:
  - user_value
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Refine only the default terminal output of `px draft` so a first-time operator can understand what mission was created, inspect it before execution, and know the next action without being distracted by internal workflow plumbing.

This is part of the trust-layer repositioning and the README first-run demo. The demo should still show the drafting agent working; asciinema replay timing will be used separately to fast-forward uninteresting waiting. This task must not hide or redesign agent activity itself.

After:

```sh
px draft "create a hello world program"

normal output should make these facts immediately legible:

the mission being drafted and the agent doing the drafting;
that the mission draft completed successfully;
the resulting mission identity/title;
the mission file/path the operator can inspect before delegating implementation;
the mission branch/worktree when useful for operator trust and orientation;
the next action, px active.

Successful internal plumbing such as SQLite persistence, Backlog synchronization, .gitignore maintenance, stats recording, and similar implementation details should not compete with the mission result in default output unless there is an error. They may remain available in verbose/debug output where such a mode already exists or can be introduced without expanding scope materially.

Scope
Change only px draft presentation/reporting.
Preserve the existing draft workflow, lifecycle transitions, agent selection/failover, mission contents, persistence, telemetry collection, and failure behavior.
Keep meaningful live agent activity visible while the drafting agent is running.
Improve the final draft summary and inspection/next-step guidance.
Ensure warnings, failures, fallbacks, and other operator-relevant exceptional conditions remain visible.
Update/add focused tests for the changed terminal contract.
Out of scope
px active output.
px integrate output.
px diff behavior or output.
px stats or telemetry schema/storage.
README/asciinema recording, replay-speed editing, GIF/video generation, or documentation changes.
New lifecycle concepts or a general reporting framework.
Changes to agent prompts or mission drafting semantics except where strictly required to present existing results.
Acceptance criteria
 Running px draft "create a hello world program" still visibly shows that a drafting agent is working.
 On success, the default terminal output ends with a compact mission-oriented summary rather than a sequence dominated by internal implementation steps.
 The summary identifies the created mission and provides the concrete mission file/path an operator can inspect before running it.
 The summary gives px active as the clear next action.
 Successful telemetry/database/backlog/plumbing messages that do not require operator action are suppressed or demoted from the default happy-path output.
 Agent fallback, warnings, failures, and actionable repair information remain visible.
 No behavior changes are introduced to draft workflow state, persistence, task transitions, worktree/branch creation, or agent execution.
 Existing relevant tests pass and focused tests cover the new default output.
Verification

Use the repository's normal verification entrypoint for the affected CLI/application area. Add assertions around the externally visible px draft happy-path terminal contract and ensure failure/fallback output remains observable.
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
