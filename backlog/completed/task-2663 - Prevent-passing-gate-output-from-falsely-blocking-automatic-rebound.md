---
id: TASK-2663
title: Prevent passing gate output from falsely blocking automatic rebound
status: done
assignee: [claude]
created_date: '2026-10-06 10:35'
labels:
  - bug
dependencies: []
priority: high
ordinal: 171008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During px integrate task-2650, integration-local failed because a headless CLI test used 2.043 CPU seconds against a 2.000-second budget. Rebound stopped with structured failure requires human action and 0 repair attempts.

Confirmed reproduction: classifyReboundReason with kind gate-failure, exitCode 1, stdout containing the passing title "✔ R8: direct review → done forbidden — integrate requires integration status" followed by an integration-test-cpu:exceeded failure returns InfraBlocker / HumanOnly / isRelaunchable false. The passing title contains forbidden, which matches the explicit human-only diagnostic regex. The actual failed contract is repairable and does not establish an infrastructure blocker.

Owners: src/application/failure-classification.ts (hasExplicitHumanOnlyDiagnostic / classifyError) and src/application/rebound-kernel.ts (classifyReboundReason). Trace how gate stdout/stderr and structured failure facts reach these owners before choosing the fix. Preserve one classification authority and genuine infrastructure/state-machine escalation. Do not solve this by renaming the passing test, disabling human-only detection, or weakening CPU guards. Keep the original CPU-budget repair separate from this classification defect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A retained focused regression reproduces the observed passing-title plus CPU-failure output, fails before the fix, and classifies the failed gate as GateFailure / AutoSendBack after the fix.
- [ ] #2 Passing test names and incidental output containing human-only keywords cannot by themselves suppress repair of an otherwise repairable gate failure.
- [ ] #3 Actual authentication, connection, infrastructure, and state-machine blockers continue to receive the existing HumanOnly dispatch when supported by failure evidence.
- [ ] #4 An existing rebound or integration-gate contract proves that this false-positive scenario reaches the repair path instead of returning human-only with zero attempts, without launching a real agent.
- [ ] #5 Extend the owning suites, run focused regressions and required static analysis, and preserve ports-and-adapters boundaries.
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
