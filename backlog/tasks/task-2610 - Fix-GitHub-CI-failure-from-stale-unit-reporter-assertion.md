---
id: TASK-2610
title: Fix GitHub CI failure from stale unit reporter assertion
status: backlog
assignee: []
created_date: '2026-09-29 05:43'
labels:
  - bug
dependencies: []
references:
  - >-
    https://github.com/oxtan-maker/parallix/actions/runs/36525076957/job/109266214152
priority: high
ordinal: 138008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Failure
GitHub Actions ci-required job https://github.com/oxtan-maker/parallix/actions/runs/36525076957/job/109266214152 failed on 2026-09-29 at commit 53b9f8339 during `npm run test:ci` → `npm test`. The sole reported failing test is `TASK-2423: headroom mode keeps the per-test reporter without changing the default plan` in `test/task-2423-repro.test.ts:41`. Its assertion expects `defaultPlan.nodeArgs` to contain `unit-test-budget-reporter.mjs`.

## Cause
`buildTestRunPlan` in `test/lib/test-run-plan.ts` intentionally omits the budget reporter when `GITHUB_ACTIONS=true` (TASK-2542). The TASK-2423 test inherits that environment from GitHub Actions but assumes a local run. `test/task-2542-repro.test.ts` already asserts the GitHub reporter exclusion. The stale TASK-2423 assertion contradicts this intended policy.

## Scope
Make the TASK-2423 plan assertion hermetic: test the local/default and headroom plans with an explicit local GitHub Actions setting, restoring any mutated environment afterward. Assert the GitHub plan omits the reporter separately, or rely on the existing TASK-2542 regression without duplicating it. Check related timing-plan tests for the same ambient-environment assumption. Preserve the local 1,000 ms cap, opt-in 500 ms headroom, and GitHub timing suspension; do not enable the reporter in CI just to satisfy the stale assertion. Read ADR 0059 before changing test selection or tier classification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Under GITHUB_ACTIONS=true, the focused TASK-2423 regression passes and the default GitHub plan omits the budget reporter.
- [ ] #2 Under an explicit local environment, default and headroom plans retain the reporter; headroom remains 500 ms and the hard cap remains 1,000 ms.
- [ ] #3 Environment changes in tests are restored so results do not depend on test order or the runner environment.
- [ ] #4 Focused tests and the GitHub-safe test path pass; repository static analysis passes.
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
