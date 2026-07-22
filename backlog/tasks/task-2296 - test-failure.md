---
id: TASK-2296
title: test failure
status: review
assignee: [custom]
created_date: '2026-07-22 05:33'
labels: []
dependencies: []
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A mission about domain modelling (2294) was hit by a bug that is probably in main, check how the backlog.md tasks are structured and create a backlog.md on main directory for fixing the test failure ℹ duration_ms 6682.356731
✖ failing tests:
test at test/task-1107-repro.test.ts:2:11187
✖ rebaseBeforeReviewRound uses the compiled CLI outside a source checkout (5.267075ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      {
        args: [
  +       '/home/magnus/code/parallix-task-2294/.test-runtime/px.js',
  -       '/home/magnus/code/parallix-task-2294/dist/px.js',
          'rebase',
          'task-1107',
          '--push'
        ],
        command: '/home/magnus/.nvm/versions/node/v24.15.0/bin/node'
  
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-2294/test/task-1107-repro.test.ts:311:10)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [ { command: '/home/magnus/.nvm/versions/node/v24.15.0/bin/node', args: [Array] } ],
    expected: [ { command: '/home/magnus/.nvm/versions/node/v24.15.0/bin/node', args: [Array] } ],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
[FAIL] Forgejo PR creation/update failed: verification gate failed for /home/magnus/code/parallix-task-2294 with exit code 1
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
