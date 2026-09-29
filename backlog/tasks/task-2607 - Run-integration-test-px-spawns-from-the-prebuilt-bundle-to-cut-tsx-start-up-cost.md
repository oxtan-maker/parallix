---
id: TASK-2607
title: >-
  Run integration-test px spawns from the prebuilt bundle to cut tsx start-up
  cost
status: backlog
assignee: []
created_date: '2026-09-28 14:50'
labels:
  - ai_sdlc
  - testing
  - performance
dependencies: []
references:
  - test/task-2468-adhoc-lifecycle-repro.test.ts
  - scripts/pre-integration-profile.ts
  - test/lib/test-categories.ts
  - workflow.config.json
priority: high
ordinal: 136008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integration tests that start the `px` CLI usually do it as `node --import tsx src/entry/px.ts ...`. Each of these spawns pays about 2.3–2.7s of tsx start-up. `node build/px.mjs` starts in about 0.3s. Tests that spawn `px` many times (stub agents recording mission contracts, lifecycle fixtures) spend most of their runtime starting the CLI rather than exercising it. Under parallel gate load this pushes tests past their timeouts: `task-2468-adhoc-lifecycle-repro` hit `spawnSync ... ETIMEDOUT` at the 60s `px draft` cap in integration-ci. The total integration time is also too large.

TASK-2598 showed the pattern on `test/task-2468-adhoc-lifecycle-repro.test.ts`, in commits "chain adhoc lifecycle stub writes from their returned versions" and "run the adhoc lifecycle stub's px writes from the prebuilt bundle". The test went from about 47s to about 16s solo:
1. Stub `px` writes use the version each write prints instead of re-reading `px status --json` before every write (18 spawns became 11).
2. When `PARALLIX_PREBUILT_PACK=1`, harness `px` spawns run `build/px.mjs` without a loader. The `:prebuilt` integration lanes set that variable, and the integration-ci gate runs `after: ["build"]`, so the bundle is fresh. Focused runs keep using source.

Apply this across the integration tiers (integration-ci and integration-local) through one shared test helper that resolves the px entry and loader, instead of each test copying the logic. Candidates found by grepping for `src/entry/px.ts` include task-2557-sandbox-px-write, task-2582/2601/2388 repros, px-runtime-smoke, px-shell-init, running-sessions, dependency-graph and task-2455, plus tests that spawn `px` through their own loader constants. Measure first with `npx tsx scripts/pre-integration-profile.ts --skip quality-gate` (per-file timings under tmp/test-profile/) and start with the slowest files.

Decide per test whether the `px` spawn is the code under test or harness. Coverage (`PARALLIX_TEST_COVERAGE=1`) maps to source, so a test whose assertions depend on coverage of the spawned CLI must either keep that spawn on source or accept bundle coverage. Record that decision in the helper or the owning ADR (see ADR 0059 on test selection).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A shared test helper resolves the px entry/loader: build/px.mjs with no loader when PARALLIX_PREBUILT_PACK=1 and the bundle exists, otherwise src/entry/px.ts via tsx
- [ ] #2 Every integration-ci and integration-local test that spawns px either uses the helper or has a stated reason for staying on source
- [ ] #3 Stub agents that record mission contracts chain --expected-version from each write's output instead of re-reading px status
- [ ] #4 pre-integration-profile shows integration-ci and integration-local wall time reduced versus the pre-change baseline, with both numbers recorded as mission evidence
- [ ] #5 No test loses verification: the same assertions pass, and coverage gates still pass
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
