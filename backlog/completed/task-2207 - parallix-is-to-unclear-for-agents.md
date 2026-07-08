---
id: TASK-2207
title: parallix is to unclear for agents
status: done
assignee: [codex]
created_date: '2026-07-08 04:37'
labels: ["ai_sdlc"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
weak agents has a hard time completing missions in parallix, common errors:

 duration_ms 356108.644614

✖ failing tests:

test at test/e2e-real-agent-smoke.test.js:390:1
✖ real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7) (356100.969328ms)
  AssertionError [ERR_ASSERTION]: [parallix-workflow-failure] px active --implementer custom failed (status=1): [FAIL] The final checkpoint at missions/task-9001/CP-2.md has a "## Goal Check" section but no evidence rows that cite a verifiable file:line, ADR, or test reference. A goal-check table with real evidence is required before handoff. Offending row: | `bin/hello.sh` exists as regular file with execute permissions | `stat -c '%A' bin/hello.sh` → `-rwxrwxr-x` | PASS |
  [FAIL] The final checkpoint at missions/task-9001/CP-2.md has a "## Goal Check" section but no evidence rows that cite a verifiable file:line, ADR, or test reference. A goal-check table with real evidence is required before handoff. Offending row: | `bin/hello.sh` exists as regular file with execute permissions | `ls -la bin/hello.sh` → `-rwxrwxr-x` (file metadata) | PASS |
  [FAIL] Reviewer custom did not submit a formal review outcome for mission/task-9001.
         The reviewer agent may have exited without posting to the review PR.
  
  
  1 !== 0
  
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1429/test/e2e-real-agent-smoke.test.js:606:12)
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

Ensure the mission template and/or draft instructions make it clear in the mission what an agent needs to do when it comes to checkpoint documentation and format to be able to pass a mission successfully, and check for bugs in the autobounce, since parallix is supposed to give the agent at least 2 attempts to fix it (that may or may not work, investigate).

symptom: the e2e tests upon integrating is very flaky, even with easy missions such as creating a hello world program (with weak agents)
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
