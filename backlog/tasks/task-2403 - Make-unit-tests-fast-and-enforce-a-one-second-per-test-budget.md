---
id: TASK-2403
title: Make unit tests fast and enforce a one-second per-test budget
status: ready-for-integration
assignee: [codex]
created_date: '2026-08-23 07:25'
labels: [user_value]
dependencies: []
ordinal: 113917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Parallix unit tests are too slow, and the current suite classification has started hiding that problem by moving some tests to the integration suite because they exceed one second. Fix the test architecture instead.

Establish and enforce this invariant:

**Every unit test must complete within 1,000 ms.**

The normal unit-test runner must use a hard per-test timeout of at most 1,000 ms. The current 30-second unit-test timeout is not acceptable.

More importantly, do not make the suite pass by relabelling slow tests.

A test belongs in integration because it intentionally crosses a real non-hermetic boundary such as a real child process, Git/worktree operation, package manager/package installation, network/server boundary, real persisted SQLite fixture or equivalent external-system behavior.

Runtime alone is NEVER a reason to classify a test as integration.

Audit the current integration classification, especially entries explicitly added because they exceeded one second. For each such test:

- if it genuinely crosses an integration boundary, keep it integration and document/classify it for that boundary, not because it is slow;
- if it is hermetic/unit-level, return it to the unit suite and make it fast enough to satisfy the one-second limit.

Likely sources of unit-test slowness include real timers/sleeps, unnecessary render cycles, overly broad application composition, repeated expensive fixture construction, SDK/session setup that should be replaced by direct seams, full-board construction when a small projection would prove the behavior, and unit tests accidentally exercising integration behavior.

Fix those causes rather than raising limits.

Do not weaken tests to hit the target:

- no deleting meaningful assertions
- no `.skip`/`.only`
- no replacing behavioral assertions with implementation-free smoke assertions
- no arbitrary sleeps shortened until they become flaky
- no mocking the actual unit under test
- no moving files to integration solely because they fail the one-second budget
- no globally forcing test process exit to hide leaked handles

Prefer deterministic clocks/timers, focused application ports, reusable lightweight fixtures and direct unit seams.

The test runner's classification should become understandable and maintainable. If the current content heuristic plus a large manually curated list is contributing to misclassification, simplify it where safe, but do not turn this mission into a test-framework rewrite.

Measure and record before/after default unit-suite duration as mission evidence. The hard correctness gate is per-test <= 1 second; total suite runtime must not regress from the uncontended baseline and should improve materially as a consequence of fixing slow tests.

Integration tests are exempt from the one-second per-test budget and retain appropriate integration-level timeouts.

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
