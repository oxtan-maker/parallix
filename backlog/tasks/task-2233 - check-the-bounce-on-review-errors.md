---
id: TASK-2233
title: check the bounce on review errors
status: backlog
assignee: []
created_date: '2026-07-12 06:39'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
in e2e test I got this error:

✖ real custom-agent launcher smoke (opencode): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7) (402896.151281ms)
  AssertionError [ERR_ASSERTION]: [parallix-workflow-failure] px active --implementer custom failed (status=1): [FAIL] Reviewer custom did not submit a formal review outcome for mission/task-9001.
         The reviewer agent may have exited without posting to the review PR.
  
  
  1 !== 0
  
      at runRealAgentSmoke (/home/magnus/code/parallix-task-2214/test/e2e-real-agent-smoke.test.js:722:12)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-2214/test/e2e-real-agent-smoke.test.js:805:3)
      at Test.runInAsyncScope (node:async_hooks:214:14)
      at Test.run (node:internal/test_runner/test:1047:25)
      at Test.start (node:internal/test_runner/test:944:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 1,
    expected: 0,
    operator: 'strictEqual',
    diff: 'simple'
  }
=== FAIL: integration:custom-agent-smoke ===

Check the ADR for what rebounce we should have on this one, fix the above error and ensure we have a complete implementation for all the review bounces as part of the ADR
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
