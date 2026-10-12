---
id: TASK-2731
title: Reduce mission authoring round trips and expose classification in status
status: backlog
assignee: []
created_date: '2026-10-12 10:39'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 229008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during TASK-2727 concurrent real-agent smoke replay: draft required 18/23 tool calls and 264/434 seconds for a one-line shell fix. Agents invoked goal, scope, criteria, checkpoint plans, gate, NEL and classification as separate model turns, then both queried classification help/get after status did not show it.

Add a public typed batch operation for mission authoring so an agent can submit related goal/scope/criteria/checkpoint-plan/gate/NEL/classification mutations in one invocation. Keep existing single mutations compatible. Validate the complete request through application/domain rules and existing typed ports, preserve authorization and optimistic concurrency, and reject invalid batches without partial writes. Update authoring guidance to use the operation. Show recorded classification in human status and preserve it in JSON status, including unset/unknown states without guessing.

Use plain-text mission criteria and evidence examples that do not require literal backticks or embedded double quotes. In TASK-2727 an agent used backticks inside a double-quoted criterion, executing bash hello.sh during drafting, causing an unintended 45-second wait and remove/re-add repair. Prefer simplifying mission/example wording over adding a separate general shell-input framework.

Do not change locked mission criteria/gates, lifecycle semantics, checkpoint evidence validation, model selection, capacity, or timeouts. Extend existing owning typed mutation/status suites and manually exercise public CLI operations on disposable state. Measure tool-call reduction on a representative draft; do not promise an unmeasured wall-time target. Coordinate with TASK-2726 fixture instructions/progress work. Do not implement this mission as part of TASK-2727.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One typed CLI invocation records a related mission-authoring batch through existing application/domain contracts; invalid or unauthorized input leaves no partial mutations and stale expected versions are rejected.
- [ ] #2 Existing single-mutation commands remain compatible; batch behavior has focused owning-suite coverage and a manual disposable public CLI check.
- [ ] #3 Human and JSON status expose the recorded classification and distinguish unset/unknown without inferred values; owning status assertions pass.
- [ ] #4 Authoring and smoke mission examples use plain-text criteria/evidence without requiring backticks or embedded double quotes; existing evidence reference validation remains enforced.
- [ ] #5 Record representative before/after authoring command or tool-call counts; run docs verification, static analysis and focused owning contract gates.
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
