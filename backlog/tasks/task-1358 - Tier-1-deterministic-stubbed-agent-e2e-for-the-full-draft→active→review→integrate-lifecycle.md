---
id: TASK-1358
title: >-
  Tier 1: deterministic stubbed-agent e2e for the full
  draft→active→review→integrate lifecycle
status: backlog
assignee: []
created_date: '2026-06-26 18:05'
labels:
  - quality
  - testing
  - bug-reduction
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug-reduction initiative #6, Tier 1 (the high-ROI half). Build an end-to-end test that runs the ENTIRE real mission lifecycle — draft → active → review → integrate — over real git, real worktrees, and real backlog files, with the agent replaced by a deterministic scripted stub that writes a known diff + checkpoint.

Why stub instead of a real model: all the bug-catching power is in exercising the real lifecycle composition (where the #2 cluster lives), not in the agent's content. A stub makes the test deterministic, dependency-free, and fast enough to run pre-integrate — without the flakiness/runtime/environment cost a real model would add (see Tier 2, the separate smoke task).

Targets the largest uncovered cluster — state-machine/id/path composition bugs that unit tests miss because mocks encode the same wrong assumption as the code: TASK-1317 (id minted twice), TASK-1352 (wrong rootDir on feature-branch missions), TASK-1327 (wrong board state), TASK-1275 (slug↔task-id mismatch).

Assertions the happy path should make:
- mission branch + sibling worktree created with the expected shape
- backlog task transitions through the correct states
- MISSION.md + CP-*.md artifacts present and committed
- minted task id is unique (no recycling/collision)
- review phase produces findings/outcome/verdict artifacts
- integrate squash-merges cleanly to primary and cleans up branch/worktree

Placement: pre-integrate (or a dedicated e2e suite), NOT the per-checkpoint gate — keep the sub-30s checkpoint budget (TASK-1133) intact. First scenario should include the feature-branch mission path, since that is where TASK-1352 lived.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A scripted/stubbed agent drives a full draft→active→review→integrate run against real git, worktrees, and backlog files with no real model dependency
- [ ] #2 The test is deterministic and runs without any external model or network
- [ ] #3 Assertions cover branch/worktree shape, backlog state transitions, mission/checkpoint artifacts, task-id uniqueness, review artifacts, and a clean squash-merge + cleanup
- [ ] #4 The first scenario exercises the feature-branch mission path (TASK-1352 regression surface)
- [ ] #5 The e2e runs outside the per-checkpoint gate (pre-integrate or dedicated suite) so the TASK-1133 budget is preserved
<!-- AC:END -->
