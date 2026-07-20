---
id: TASK-2292
title: Restore integration-suite defense on px integrate
status: backlog
assignee: [codex]
created_date: '2026-07-20 00:00'
labels:
  - testing
  - reliability
  - workflow
  - regression
dependencies: []
references:
  - package.json
  - test/run-default-tests.js
  - config/integration-pipelines.json
  - scripts/verify-local.sh
  - lib/commands/integrate.ts
  - test/verify-local-integrate.test.ts
  - test/integration-pipelines.test.ts
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Restore the coverage displaced from the default unit suite by TASK-2275. The
explicit `npm run test:integration` suite must be a mandatory `px integrate`
defense, not merely a command an operator may remember to run. It covers the
real process, Git/worktree, package, network-boundary, and explicitly listed
integration groups that `npm test` intentionally excludes.

Make the integration gate plan run that suite for every mission integration,
including documentation, backlog, and mission-artifact-only changes. If
changed-area filtering currently cannot represent one of those paths, change
the gate-selection contract rather than silently skipping the suite. Preserve
the dedicated lifecycle and real-agent-smoke gates; this is additive coverage,
not a replacement for either. Keep unit tests fast and hermetic: test the
planner and runner with mocks/disposable fixtures only, never real Forgejo,
agents, network services, nested `px`, or recursive verifier execution.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 `px integrate`'s resolved gate plan contains a named command that executes `npm run test:integration`, and a nonzero result prevents the squash merge
- [ ] #2 The integration-suite gate is selected for `lib`, `workflow`, `docs`, `backlog`, and mission-artifact-only diffs; no recognized or unrecognized changed path may bypass it through an empty or non-matching area list
- [ ] #3 The existing `workflow` lifecycle E2E and `custom-agent-smoke` gates remain separate, retain their current commands/order semantics, and still run whenever their existing area rules require them
- [ ] #4 Tests prove the final resolved gate plan for representative `lib`, `workflow`, `docs`, backlog/mission-only, and no-area cases; each test asserts both the integration-suite command and the absence/presence of the other area-scoped gates
- [ ] #5 A runner-level test proves an integration-suite failure aborts before integration can proceed, using a mocked command runner or disposable fixture command rather than the real suite
- [ ] #6 `npm run test:integration` remains explicit and contains every test excluded from `npm test`; its routing-regression test fails if a boundary suite becomes neither default nor integration coverage
- [ ] #7 New unit tests use strict mocks and disposable files only; they do not contact Forgejo, launch agents, access network services, invoke nested `px`, or run the full verifier recursively
- [ ] #8 Focused planner/runner/routing tests, `npm run test:integration`, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` pass on the final tree
<!-- AC:END -->

## Implementation Plan

1. Inventory the current default-suite exclusions and the integration gate plan for each changed-area class.
2. Add a named integration-suite gate and make its selection unconditional for `px integrate`, while leaving lifecycle and real-agent-smoke selection rules intact.
3. Extend planner and verifier tests with representative areas, unknown paths, and a failing disposable gate command.
4. Run the explicit integration suite and required repository gates; record the exact resolved plan and failure-path evidence.

## NEL Estimate

Small (40–80 NEL): pipeline configuration, changed-area/gate-plan behavior,
and focused regression tests. Stop and split if restoring the gate requires
changing test semantics, Forgejo infrastructure, or agent-runner behavior.

## Agent-completeness guardrails

- Do not satisfy this task by documenting `npm run test:integration`, printing
  a proposed plan, or adding a gate that only applies to `lib`/`workflow`.
- Do not fold lifecycle E2E or real-agent smoke into the general integration
  suite, remove their gates, weaken their area selection, or mark them skipped.
- A passing happy-path plan is insufficient: tests must prove that a failing
  integration-suite command stops integration and that documentation-only and
  mission/backlog-only changes cannot select zero defenses.
- Do not reclassify boundary tests back into `npm test` merely to make a green
  default-suite result appear comprehensive; preserve the fast unit boundary.

## Rollback

Revert the integration-suite gate and its gate-selection/test changes as one
commit. This restores the prior scheduling behavior but does not alter test
files, workflow state, task records, or Forgejo state.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Every `px integrate` path has the explicit integration suite in its resolved gate plan
- [ ] #2 Failure propagation is proven without real external services
- [ ] #3 Lifecycle and real-agent E2E defenses remain independently scheduled
- [ ] #4 Default and integration test routing remain mutually complete
- [ ] #5 Required focused, integration, general, and static-analysis verification commands pass
<!-- DOD:END -->
