---
id: TASK-2676
title: dependabot pipelines
status: backlog
assignee: []
created_date: '2026-10-07 06:40'
labels: []
dependencies: []
ordinal: 188008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ensure dependabot works on newer pipelines, currently it gets: 

✖ failing tests:

test at test/integration/verification/sonarqube-cloud-wiring.test.ts:41:1
✖ local sonar scan submits the worktree branch to the one Cloud project (20.835708ms)
  Error: Cannot resolve the Git branch for the Sonar analysis; check out a branch before scanning.
      at resolveSonarBranch (/home/runner/work/parallix/parallix/scripts/sonar-local.ts:27:45)
      at runSonar (/home/runner/work/parallix/parallix/scripts/sonar-local.ts:92:36)
      at run (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:31:18)
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:43:3)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.start (node:internal/test_runner/test:1262:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:387:17)

test at test/integration/verification/sonarqube-cloud-wiring.test.ts:96:1
✖ sonar scan fails closed when the quality gate does not pass (12.354693ms)
  AssertionError [ERR_ASSERTION]: The input did not match the regular expression /analysis or quality gate failed/. Input:
  
  'Error: Cannot resolve the Git branch for the Sonar analysis; check out a branch before scanning.'
  
      at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:100:10)
      at Test.runInAsyncScope (node:async_hooks:226:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: Error: Cannot resolve the Git branch for the Sonar analysis; check out a branch before scanning.
        at resolveSonarBranch (/home/runner/work/parallix/parallix/scripts/sonar-local.ts:27:45)
        at runSonar (/home/runner/work/parallix/parallix/scripts/sonar-local.ts:92:36)
        at run (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:31:18)
        at getActual (node:assert:580:5)
        at strict.throws (node:assert:728:24)
        at TestContext.<anonymous> (/home/runner/work/parallix/parallix/test/integration/verification/sonarqube-cloud-wiring.test.ts:100:10)
        at Test.runInAsyncScope (node:async_hooks:226:14)
        at Test.run (node:internal/test_runner/test:1402:25)
        at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
        at Test.postRun (node:internal/test_runner/test:1542:19),
    expected: /analysis or quality gate failed/,
    operator: 'throws',
    diff: 'simple'
  }
Error: Process completed with exit code 1.

Example: https://github.com/oxtan-maker/parallix/actions/runs/37579115060/job/112654537327?pr=13
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
