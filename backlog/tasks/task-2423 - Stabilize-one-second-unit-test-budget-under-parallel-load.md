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
failure, yet multiple ordinary unit tests already take roughly that long when
other mission agents are verifying in parallel. On 2026-08-27, unrelated
adapter, review, setup, and rebound tests exceeded the limit on both `main`
and an otherwise focused TASK-2414 worktree. A rebounce cannot repair the
mission that happens to trigger this shared-capacity failure.

Keep the one-second hermetic-test requirement, but make normal unit tests
finish within 500 ms even while many missions verify in parallel. Fix tests
that cross real boundaries rather than treating their wall-clock delay as a
unit-test concern. Runner concurrency may be reduced as a supporting control,
but it is not a substitute for fast tests. Do not turn a flaky measurement
into an implicit pass or relax the requirement globally.

## Acceptance Criteria

- [ ] #1 A reproducible regression demonstrates the current loss of headroom under supported parallel mission verification.
- [ ] #2 Every ordinary unit test completes within 500 ms under the supported parallel mission load; reducing runner concurrency alone does not satisfy this criterion.
- [ ] #3 The default verifier no longer strands unrelated missions solely because concurrent supported work inflates a unit-test duration.
- [ ] #4 Tests that genuinely exceed the one-second hermetic unit-test contract still fail with an actionable diagnostic.
- [ ] #5 The suite-level budget and integration-test boundary remain enforced.

## Scope

- Reuse the existing test-runner and reporter infrastructure.
- Prefer making heavyweight tests hermetic or reducing shared runner concurrency over per-mission retry exceptions.
- Do not suppress `[unit-test-budget:exceeded]` diagnostics in rebound classification.

## Definition of Done

- [ ] #1 Focused regression coverage is green and distinguishes environmental contention from a real slow unit test.
- [ ] #2 The canonical general verifier passes repeatedly under the supported concurrency setting.
- [ ] #3 No mission-specific bypass, timeout allowlist, or hidden retry is introduced.
