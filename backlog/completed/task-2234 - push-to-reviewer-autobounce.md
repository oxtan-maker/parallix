---
id: TASK-2234
title: push to reviewer autobounce
status: done
assignee: [custom]
created_date: '2026-07-12 08:41'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ipped 23
ℹ todo 0
ℹ duration_ms 13098.616294

✖ failing tests:

test at test/handoff.test.js:1516:1
✖ runDeclaredGates rejects explanatory dash suffixes (7.006177ms)
  AssertionError [ERR_ASSERTION]: true — some description
  
  true !== false
  
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-2223/test/handoff.test.js:1522:14)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: true,
    expected: false,
    operator: 'strictEqual',
    diff: 'simple'
  }
[FAIL] Push to review provider failed: verification gate failed for /home/magnus/code/parallix-task-2223 with exit code 1

autobounce seems missing
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

**Fix 1 — Declared-gate validation:** `lib/commands/handoff.ts:830-849` now checks for explanatory dash suffix (em-dash, en-dash, double-dash + prose) before stripping, rejecting with `validation-failed` so `validateDeclaredGates` never sees a silently sanitized command. Fixes `test/handoff.test.js:1516` "runDeclaredGates rejects explanatory dash suffixes".

**Fix 2 — Auto-bounce on validation failure:** `lib/review/review-commands.ts:907-911` in `pushRound` now detects `validation-failed` from `createPr` and transitions the task back to `active` with the rejection reason surfaced in error output. Non-validation failures (infra, auth) do not bounce.

**Tests:** `test/task-2234-push-to-reviewer-autobounce.test.js` — 4/4 GREEN (was 1/4 at parent commit). Full affected suite: 114/114 pass. Static analysis: clean.

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
