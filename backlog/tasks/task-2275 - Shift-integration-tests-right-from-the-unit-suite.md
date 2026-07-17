---
id: TASK-2275
title: shift integration tests right from the unit suite
status: review
assignee: [codex]
created_date: '2026-07-17 00:00'
labels: [testing, performance, ai_sdlc]
dependencies: []
priority: high
---

## Description

The default unit-test suite is taking too long to provide useful local feedback.
Shift integration coverage to the right: tests that depend on real processes,
repositories, command-line tools, network services, packaging, or other non-hermetic
boundaries belong in explicitly invoked integration or E2E suites, not the default
unit suite.

Treat any unit test taking more than one second in an uncontended local run as suspect
for being an integration test. Profile each such test and either make it hermetic and
fast, move it to the appropriate later suite, or document a specific reason why it is
genuine unit coverage and cannot reasonably meet the threshold.

## Codex Pre-Draft

**Goal:** make the default unit suite a reliable, fast feedback loop by relocating
integration-style coverage to later verification layers without losing coverage.

**Scope and proof:** capture per-test runtime for a clean, uncontended default-suite
run; inventory tests exceeding one second and their external dependencies; classify
each test as unit, command-line integration, or E2E; make unit tests hermetic through
dependency injection or fakes; move intentional boundary coverage behind explicit
integration/E2E entry points; and measure the resulting default-suite runtime.

**Checkpoints:** (1) baseline timing and classification inventory; (2) migrate or
hermeticize suspect tests while preserving behavior coverage; (3) wire later suites
into the appropriate integration gates and capture before/after timing evidence.

**Stop rule:** do not remove coverage or replace tests of real Git, worktree, process,
packaging, or network behavior with mocks; preserve those tests by moving them to a
clearly named later suite. Do not classify a test only by its filename—use its runtime
and dependencies.

## Acceptance Criteria

- [ ] Per-test timing is captured for the default unit suite under documented uncontended conditions.
- [ ] Every default-suite test taking more than one second is classified as made faster/hermetic, moved to an integration or E2E suite, or retained with a documented unit-test justification.
- [ ] The default unit suite has no test over one second without that explicit justification and a follow-up owner for runtime reduction where practical.
- [ ] Tests that execute real command-line tools, repositories, packaging, network services, or agent binaries are invoked from clearly named integration or E2E suites rather than the default unit suite.
- [ ] Moved coverage continues to run in the appropriate integration gate and uses disposable, cleaned-up artifacts.
- [ ] Before-and-after default-suite timing is recorded, and no behavior coverage is deleted merely to reduce runtime.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
