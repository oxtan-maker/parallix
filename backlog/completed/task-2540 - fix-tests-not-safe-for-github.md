---
id: TASK-2540
title: fix tests not safe for github
status: done
assignee: [custom]
created_date: '2026-09-19 06:06'
labels: ["ai_sdlc"]
dependencies: []
ordinal: 88007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
all timing tests are flaky on github and should not be run there, ensure that these tests are not run on github

d transport version is rejected as an incompatible client (0.570488ms)
✔ progress event DTO is versioned and validated (0.52367ms)
✔ unsupported projection version is rejected before conversion (0.437068ms)
✔ snapshot card DTO carries pullRequest, reviewApproved, and reviewHistory through a JSON round trip (3.493337ms)
✔ snapshot card DTO keeps pullRequest null when the card has no pull-request reference (0.353291ms)
✔ snapshot card DTO round-trips reviewApproved and every per-round reviewHistory field (0.464069ms)
✔ snapshot validation accepts the extended card and fails closed on malformed card facts (1.264797ms)
✔ transport version 2 rejects v1 payloads as incompatible clients, not invalid payloads (0.254737ms)
✔ snapshot metrics are projected and malformed metrics fail closed (0.21926ms)
✔ conversion is pure: the source projection is not mutated and the output is deterministic (0.692276ms)
ℹ tests 2859
ℹ suites 47
ℹ pass 2856
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 82862.755685

✖ failing tests:

test at test/task-2423-repro.test.ts:1:306
✖ TASK-2423: headroom mode reports 501ms work while preserving the 1000ms hard cap (23.668098ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /\[unit-test-budget:headroom\] headroom work: 501ms > 500ms/. Input:
  
  '✔ headroom work (501ms)\n✔ hard-cap work (1001ms)\n'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/task-2423-repro.test.ts:25:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '✔ headroom work (501ms)\n✔ hard-cap work (1001ms)\n',
    expected: /\[unit-test-budget:headroom\] headroom work: 501ms > 500ms/,
    operator: 'match',
    diff: 'simple'
  }

test at test/unit-test-budget-reporter.test.ts:1:364
✖ unit-test budget reporter marks measured synchronous work over the bound (15.900886ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /\[unit-test-budget:exceeded\] sync block: 1001ms > 1000ms/. Input:
  
  '✔ sync block (1001ms)\n'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/unit-test-budget-reporter.test.ts:21:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '✔ sync block (1001ms)\n',
    expected: /\[unit-test-budget:exceeded\] sync block: 1001ms > 1000ms/,
    operator: 'match',
    diff: 'simple'
  }

test at test/unit-test-budget-reporter.test.ts:1:836
✖ unit-test budget reporter reports opted-in headroom without changing the hard cap (2.507833ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /\[unit-test-budget:headroom\] near-bound work: 501ms > 500ms/. Input:
  
  '✔ near-bound work (501ms)\n'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/unit-test-budget-reporter.test.ts:42:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '✔ near-bound work (501ms)\n',
    expected: /\[unit-test-budget:headroom\] near-bound work: 501ms > 500ms/,
    operator: 'match',
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
