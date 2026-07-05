---
id: TASK-1359
title: >-
  Tier 2: non-blocking real-local-model smoke test for the agent-launcher
  surface
status: done
assignee: [codex]
created_date: '2026-06-26 18:06'
updated_date: '2026-07-05 06:24'
labels: [ai_sdlc]
dependencies: []
priority: low
---
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create one e2e test using custom agent (local AI that is free) so that we get test coverage on stuff that is not covered in the 'e2e' tests that have simple mocked agent (prompts are actionable for example)

Rationale: the real model adds realism only to the launcher/telemetry/limit-detection surface, which is exactly where TASK-1351 (opencode -m flag rejects valid model) and TASK-1273 (qwen draft bug) lived. Tier 1 (stubbed e2e) cannot catch those because it bypasses the real agent invocation.

Scope assertions to integration only:
- the configured local-AI family is launched with valid args (would have caught TASK-1351)
- the agent produces a parseable mission/checkpoint (would have caught TASK-1273)
- telemetry/limit-detection records something sane
- force custom as reviewer on its own pr as well
- make the test mission as simple as possible
- steer away telemetry (config) to another location so that test do not corrupt the real telemetry
- test the telemetry output
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A smoke test runs a mission with a real cheap local-AI agent family and is explicitly non-blocking (nightly/on-demand, never in the merge gate)
- [ ] #2 Assertions are scoped to the launcher/integration surface (valid launch args, parseable agent output, sane telemetry) — not diff content
- [ ] #3 A model/agent failure is classified distinctly from a parallix failure so red runs are diagnosable
- [ ] #4 The test would have caught the TASK-1351 (launch-arg) and TASK-1273 (agent-output) classes
- [ ] #5 Documentation states it requires a local model and is not part of `npm test`
<!-- AC:END -->
