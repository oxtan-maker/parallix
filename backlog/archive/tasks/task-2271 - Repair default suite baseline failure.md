---
id: TASK-2271
title: Repair the default-suite baseline failure in integration preflight tests
status: backlog
assignee: []
created_date: '2026-07-11 07:50'
updated_date: '2026-07-11 07:50'
labels: []
dependencies: []
references:
  - test/task-1039-integrate-v3.test.js
priority: high
ordinal: 7002
---

## Description

Investigate and repair the pre-existing `printIntegrationPreflight PR approval
failures` default-suite failure, reproducing it against `main` before changing
behavior. The per-round verification gate depends on a green baseline.

## Acceptance Criteria

- [ ] The failure is reproduced on the baseline and its cause is documented.
- [ ] The default suite passes without masking the affected test.

## Codex Pre-Draft

**Goal:** restore a green default test-suite baseline by fixing the real cause of `printIntegrationPreflight PR approval failures`, not by weakening its assertion or excluding it from the runner.

**Scope and proof:** run the single test and default suite against the baseline; minimize a deterministic reproduction; identify whether the issue is production preflight logic, fixture drift, or test isolation; add regression coverage that preserves the intended failed-approval diagnostic and returns the full default suite to green.

**Checkpoints:** (1) capture baseline failure and root-cause hypothesis; (2) implement the narrow repair with a regression test; (3) run the focused test and default suite after Node is restored.

**Stop rule:** do not skip, `.todo`, loosen, or snapshot away the failing assertion; stop for direction if the baseline failure depends on unavailable external Forgejo state rather than a hermetic fixture.
