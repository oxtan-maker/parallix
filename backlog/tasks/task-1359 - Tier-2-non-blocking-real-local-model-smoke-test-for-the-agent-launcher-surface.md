---
id: TASK-1359
title: >-
  Tier 2: non-blocking real-local-model smoke test for the agent-launcher
  surface
status: backlog
assignee: []
created_date: '2026-06-26 18:06'
labels:
  - quality
  - testing
  - bug-reduction
dependencies:
  - TASK-1358
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug-reduction initiative #6, Tier 2 (the smaller, optional half — do only if launcher-integration bugs keep recurring). A smoke test that runs a mission with a REAL cheap local-AI agent and asserts only that the launcher actually invokes the agent and a valid mission completes — NOT the agent's diff content.

Rationale: the real model adds realism only to the launcher/telemetry/limit-detection surface, which is exactly where TASK-1351 (opencode -m flag rejects valid model) and TASK-1273 (qwen draft bug) lived. Tier 1 (stubbed e2e) cannot catch those because it bypasses the real agent invocation.

Hard constraint — keep it OUT of any blocking gate. Real models are non-deterministic and the local families have failed independently of parallix (TASK-1115 qwen tool_call, TASK-1273), so a model failure must never gate a merge. Run nightly or on-demand; report, don't block.

Scope assertions to integration only:
- the configured local-AI family is launched with valid args (would have caught TASK-1351)
- the agent produces a parseable mission/checkpoint (would have caught TASK-1273)
- telemetry/limit-detection records something sane

Pin to a single cheap local family; tolerate model flakiness with retries + clear "model failure, not parallix failure" classification so a red smoke run is diagnosable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A smoke test runs a mission with a real cheap local-AI agent family and is explicitly non-blocking (nightly/on-demand, never in the merge gate)
- [ ] #2 Assertions are scoped to the launcher/integration surface (valid launch args, parseable agent output, sane telemetry) — not diff content
- [ ] #3 A model/agent failure is classified distinctly from a parallix failure so red runs are diagnosable
- [ ] #4 The test would have caught the TASK-1351 (launch-arg) and TASK-1273 (agent-output) classes
- [ ] #5 Documentation states it requires a local model and is not part of `npm test`
<!-- AC:END -->
