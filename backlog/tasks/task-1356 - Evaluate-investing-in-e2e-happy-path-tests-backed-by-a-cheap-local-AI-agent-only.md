---
id: TASK-1356
title: >-
  Evaluate investing in e2e happy-path tests backed by a cheap local-AI agent
  only
status: backlog
assignee: []
created_date: '2026-06-26 18:00'
labels:
  - quality
  - testing
  - bug-reduction
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug-reduction initiative #6 (revised per operator). The second-largest historical bug cluster is state-machine/id/path logic (TASK-1275 slug↔task-id mismatch, TASK-1319/1322 id recycling, TASK-1327 wrong board state, TASK-1352 wrong rootDir). These slip through unit tests because the bug is in how the real phases compose, not in any one function.

Instead of (or before) property/invariant tests, evaluate whether it is time to invest in a true end-to-end test covering at least the happy path: `px draft → active → review → integrate` on a throwaway repo, asserting branch/worktree shape, backlog state transitions, mission/checkpoint artifacts, id uniqueness, and a clean squash-merge to primary. To keep it affordable and deterministic, the agent run inside the e2e must be pinned to a cheap LOCAL AI agent family only (no paid/cloud families), or a stubbed local agent.

Evaluation questions:
- Is the local-AI agent deterministic/cheap enough to run in the gate, or should e2e run on a slower cadence (pre-integrate / nightly) rather than every checkpoint? (cf. TASK-1133 sub-30s budget.)
- Stub the agent entirely vs drive a real local model? Trade determinism vs realism.
- Which happy path(s) first: task-file mission vs free-text draft vs feature-branch mission (the last is where TASK-1352 lived)?
- What is the maintenance cost vs the share of the state/path/id bug cluster it would actually catch?

Deliverable: a go/no-go recommendation with a proposed first e2e scenario, agent-pinning approach, and where it runs in the lifecycle.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Recommendation states whether to invest in e2e now, with rationale tied to the state/path/id bug cluster
- [ ] #2 Proposes a first happy-path scenario (draft→active→review→integrate) and the assertions it would make
- [ ] #3 Specifies the cheap local-AI agent pinning (real local model vs stub) and why it keeps the test deterministic and affordable
- [ ] #4 Specifies where e2e runs in the lifecycle (gate / pre-integrate / nightly) consistent with the TASK-1133 runtime budget
- [ ] #5 Estimates maintenance cost vs bug-cluster coverage
<!-- AC:END -->
