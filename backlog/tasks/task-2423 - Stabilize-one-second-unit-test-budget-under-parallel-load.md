---
id: TASK-2423
title: Stabilize one-second unit-test budget under parallel load
status: backlog
assignee: []
created_date: '2026-08-27'
labels: [bug, reliability]
dependencies: []
priority: high
---

## Description

The default verifier treats any unit test reported above 1,000 ms as a hard
failure. On 2026-08-27, unrelated tests exceeded that limit on both `main`
and an otherwise focused TASK-2414 worktree while the machine had ordinary
parallel mission activity. The set varied between runs and included existing
adapter, review, setup, and rebound tests, so a rebounce could not repair the
mission that happened to trigger the gate.

Keep the one-second hermetic-test requirement, but make its measurement and
enforcement reliable under supported parallel verification. Diagnose whether
the runner's worker concurrency, reporter timing, or tests that cross a real
boundary causes wall-clock inflation. Do not turn a flaky measurement into an
implicit pass or relax the requirement globally.

## Acceptance Criteria

- [ ] #1 A reproducible regression demonstrates the current false failure under supported parallel load, or isolates a specific test that violates the hermetic unit-test contract.
- [ ] #2 The default verifier no longer strands unrelated missions solely because concurrent supported work inflates a unit-test duration.
- [ ] #3 Tests that genuinely exceed the one-second hermetic unit-test contract still fail with an actionable diagnostic.
- [ ] #4 The suite-level budget and integration-test boundary remain enforced.

## Scope

- Reuse the existing test-runner and reporter infrastructure.
- Prefer fixing the shared runner or the real non-hermetic dependency over per-mission retry exceptions.
- Do not suppress `[unit-test-budget:exceeded]` diagnostics in rebound classification.

## Definition of Done

- [ ] #1 Focused regression coverage is green and distinguishes environmental contention from a real slow unit test.
- [ ] #2 The canonical general verifier passes repeatedly under the supported concurrency setting.
- [ ] #3 No mission-specific bypass, timeout allowlist, or hidden retry is introduced.
