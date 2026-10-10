---
id: TASK-2711
title: Complete TASK-2668.08 configuration migration and restore CI
status: backlog
assignee: []
created_date: '2026-10-10 06:39'
labels: []
dependencies: []
ordinal: 213008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix the six integration failures in this GitHub Actions job:

https://github.com/oxtan-maker/parallix/actions/runs/37967339706/job/113944870470

The failed commit is `5f1e5b06ed599eb463eec043052380d2c8194d89` (TASK-2668.08). Its configuration refactor left several fixtures relying on ambient environment variables. Work from the current local base, confirm which defects remain, and preserve subsequent changes.

## Required changes

1. **Migrate the agent-launch fixtures** in:
   - `test/integration/agents/agent-exit-telemetry-classification.test.ts`
   - `test/integration/agents/session-marker-repository.test.ts`

   Pass explicit fixture configuration through the existing `startAgent` and launcher seams. Include the intended sandbox opt-out, fake executable paths, and temporary state locations. GitHub already sets `PARALLIX_NO_BUBBLEWRAP=1`; the missing configuration argument makes these calls use defaults that ignore it. Make the fixtures behave consistently whether Bubblewrap is installed or absent.

2. **Repair the fake reviewer’s child environment** in `test/fixtures/review-repair-agent-preload.ts`.

   CLI startup now pins the child executable into a supplied environment instead of mutating `process.env`. Consume the launch callback’s configuration/environment for the pinned CLI command, child-process execution, and entrypoint trace. Preserve the existing real `verdict`/`resolve` sequence and its working directory; the test must complete the review/repair cycle.

3. **Migrate the persistence fixture** in `test/integration/packaging/package-persistent-data.test.ts`.

   Resolve configuration from the explicitly supplied test environment in both child-script snippets. Pass it to `upsertMeasurementRow`, `updateAgentBlock`, and `loadMeasurementRows`. Keep seeding, installed-CLI reads, reinstall, and subsequent reads pointed at the same temporary `PARALLIX_HOME`.

   Add `configuration?: ParallixConfiguration` to `updateAgentBlock`’s options type in `src/adapters/agents/agent-config.ts`; its downstream resolver already accepts configuration. Preserve the existing storage-location and value assertions.

## Scope constraints

Use the existing regression tests and helpers. Keep production confinement defaults, explicit configuration ownership, assertions, test populations, and CPU budgets intact. Do not introduce ambient-environment fallbacks, `any` casts, new E2E suites, compatibility layers, or unrelated refactoring. Keep fixture writes inside their temporary directories.

## Verification

First run the four affected suites against a current bundle; build only if the bundle is stale:

```bash
CI=true GITHUB_ACTIONS=true \
PARALLIX_NO_BUBBLEWRAP=1 PARALLIX_TEST_COVERAGE=1 \
npm run test:integration:ci:all:prebuilt -- \
  test/integration/agents/agent-exit-telemetry-classification.test.ts \
  test/integration/agents/session-marker-repository.test.ts \
  test/integration/integrate/workflow-repair-lane-boundaries.test.ts \
  test/integration/packaging/package-persistent-data.test.ts
```

Once the final tree is ready, run `npm run test:ci` once with the same environment. It performs its own build. Repeat verification only when a failure or subsequent change requires it. The ordinary local early integration gate excludes the two slower affected suites and is insufficient for this repair.

## Acceptance

- The existing telemetry-classification, fallback, and session-role assertions pass with explicit fixture configuration.
- The review fixture completes its real child-command sequence and verifies `review → active → review → integration`, retaining the pinned CLI and entrypoint assertions.
- The packaging fixture seeds the intended temporary state, reads it through the installed CLI, reinstalls, and verifies that the data remains intact.
- The final full `test:ci` check passes. Report the changed files, actual verification results, and any remaining blocker; distinguish local verification from GitHub or Sonar execution.
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
