---
id: TASK-1397
title: retake on 1358
status: backlog
assignee: []
created_date: '2026-07-01 16:55'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In order to strengthen parallix, please add support in parallix to have an e2e test run before integrating a mission ready-for-integration. This should be a general gate when parallix is used in any project.

then configure the gate for use in parallix and generate the first e2e tests and hook that up

Build an end-to-end test that runs the ENTIRE real mission lifecycle — draft → active → review → integrate — over real git, real worktrees, and real backlog files, with the agent replaced by a deterministic scripted stub that writes a known diff + checkpoint.

Why stub instead of a real model: all the bug-catching power is in exercising the real lifecycle composition (where the #2 cluster lives), not in the agent's content. A stub makes the test deterministic, dependency-free, and fast enough to run pre-integrate — without the flakiness/runtime/environment cost a real model would add (see Tier 2, the separate smoke task).

Targets the largest uncovered cluster — state-machine/id/path composition bugs that unit tests miss because mocks encode the same wrong assumption as the code: TASK-1317 (id minted twice), TASK-1352 (wrong rootDir on feature-branch missions), TASK-1327 (wrong board state), TASK-1275 (slug↔task-id mismatch).

Assertions the happy path should make:
- create a new repo with backlog setup (backlog setup should be done in this mission and the e2e test just copies it from somewhere)
- mission branch + sibling worktree created with the expected shape
- backlog task transitions through the correct states
- MISSION.md + CP-*.md artifacts present and committed
- minted task id is unique (no recycling/collision)
- review phase produces findings/outcome/verdict artifacts
- integrate squash-merges cleanly to primary and cleans up branch/worktree

Placement: pre-integrate (or a dedicated e2e suite), NOT the per-checkpoint gate — keep the sub-30s checkpoint budget (TASK-1133) intact. First scenario should include the feature-branch mission path, since that is where TASK-1352 lived.
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
