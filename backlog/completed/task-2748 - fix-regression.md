---
id: TASK-2748
title: fix regression
status: done
assignee: [codex]
created_date: '2026-10-14 18:01'
labels: []
dependencies: []
ordinal: 238008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
✖ failing tests:

test at test/unit/test/lib/default-test-suite.test.ts:73:1
✖ focused real-agent smoke uses waited-child CPU accounting (TASK-2739) (25.058865ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
  
    assert.ok(plan.nodeArgs.some(arg => arg.endsWith('/integration-cpu-hook.mjs')))
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/unit/test/lib/default-test-suite.test.ts:79:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
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
