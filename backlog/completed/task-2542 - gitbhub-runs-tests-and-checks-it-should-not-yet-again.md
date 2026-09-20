---
id: TASK-2542
title: gitbhub runs tests and checks it should not (yet again)
status: done
assignee: [custom]
created_date: '2026-09-19 16:13'
labels:
  - ai_sdlc
  - bug
dependencies: []
ordinal: 85007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
✖ failing tests:

test at test/unit-test-timeout-guard.test.ts:29:421
✖ unit-test timeout guard: suite budget enforcement fails when exceeded (3051.496311ms)
  AssertionError [ERR_ASSERTION]: Expected budget output in: 381:17) {
    code: 'ERR_MODULE_NOT_FOUND',
    url: 'file:///home/runner/work/parallix/parallix/src/adapters/agents/launcher-selection.js'
  }
  
  Node.js v24.21.0
  ✖ /tmp/budget-guard-proof-Hv7quZ/slow-suite.test.js (129.686355ms)
  ℹ tests 1

## Resolution (task-2542 landed)

The GitHub CI failure was a timing-enforcement check running where it cannot
pass: the clean runner cannot satisfy the per-test/suite timing budget, so the
suite-budget proof failed for an unrelated module-resolution reason instead of
a product regression. Per the mission this is fixed by test-run *selection*, not
by weakening or removing local timing enforcement.

- `test/unit-test-timeout-guard.test.ts` moved from `INTEGRATION_CI_TESTS` to
  `INTEGRATION_LOCAL_TESTS` (`test/lib/test-categories.ts`), so it runs only in
  the required local `--integration-local` lane, never the GitHub CI lane.
- `test/lib/test-run-plan.ts` drops the `unit-test-budget-reporter`
  `--test-reporter` from the default plan when `onGitHubActions()` is true.
- The `--unit-test-headroom` local authoring path and the per-test
  `--test-timeout` safety net are unchanged; `npm test` still enforces the
  budget locally.
- Regression test `test/task-2542-repro.test.ts` is red on the parent commit and
  green after the fix. `./scripts/verify-local.sh all` exits 0; static-analysis
  gate clean. See `missions/task-2542/CP-2.md` and `CP-3.md`.
  ℹ suites 0
  ℹ pass 0
  ℹ fail 1
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 179.219522
  
  ✖ failing tests:
  
  test at ../../../../../tmp/budget-guard-proof-Hv7quZ/slow-suite.test.js:1:1
  ✖ /tmp/budget-guard-proof-Hv7quZ/slow-suite.test.js (129.686355ms)
    'test failed'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/unit-test-timeout-guard.test.ts:232:10)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }

TIMING ENFORCEMENT IS LOCAL-ONLY: exclude it from GitHub CI test selection,
do not remove or weaken the local `npm test -- --unit-test-headroom` path.
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
