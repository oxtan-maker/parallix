---
id: TASK-2340
title: add rebounce on hooks
status: ready-for-integration
assignee:
  - codex
created_date: '2026-08-04 11:33'
updated_date: '2026-08-09 17:40'
labels:
  - user_value
dependencies: []
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
parallix sometimes fails when developing itselfs  TypeScript-authored test records a typed mock interaction (2.154852ms)
ℹ tests 1622
ℹ suites 44
ℹ pass 1619
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 21490.906396

✖ failing tests:

test at test/task-2339-review-store-bindings.test.ts:1:1
✖ /home/magnus/code/parallix-task-2328/test/task-2339-review-store-bindings.test.ts (1700.684659ms)
  'test failed'

test at test/task-2339-self-review-forbidden.test.ts:1:1
✖ /home/magnus/code/parallix-task-2328/test/task-2339-self-review-forbidden.test.ts (1159.48943ms)
  'test failed'

test at test/tui-command-flow.test.ts:1:4350
✖ Ctrl+A on enabled card shows confirmation and dispatches on Enter (188.260691ms)
  AssertionError [ERR_ASSERTION]: Ctrl+A + Enter must dispatch once
  
  0 !== 1
  
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-2328/test/tui-command-flow.test.ts:119:10)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }

[unit-test-budget] timeout=30000ms per test, suite budget=180000ms, elapsed=21545ms
[FAIL] Push to Forgejo failed: verification gate failed for /home/magnus/code/parallix-task-2328 with exit code 1
[FAIL] Rebase failed before launching reviewer for mission/task-2328.

ensure there is a bounceback on user provided hooks (all of them), with fixes and if fixes pass that parallix proceeds without human intervention
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
