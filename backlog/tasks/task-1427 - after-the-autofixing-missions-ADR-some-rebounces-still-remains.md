---
id: TASK-1427
title: after the autofixing missions/ADR some rebounces still remains
status: backlog
assignee: []
created_date: '2026-07-05 05:14'
updated_date: '2026-07-05 05:30'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Go through the ADR on that the harness should rebounce errors automatically to agents and its implementation missions, then review the total ADR and the gaps in implementation and fix them. 

Example gap: 
{"type":"step_finish","timestamp":1783187280966,"sessionID":"ses_0d260814dffepM3K2BlAeISUTv","part":{"id":"prt_f2e3e94430018ti1RZSU9jyste","reason":"stop","snapshot":"9f1ce43d35a660c9ead7726e3c082b0cf90376cd","messageID":"msg_f2e3e84e0001jAzho38d6JW18J","sessionID":"ses_0d260814dffepM3K2BlAeISUTv","type":"step-finish","tokens":{"total":50078,"input":49796,"output":282,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0}}
[FAIL] Incomplete implementer artifacts for task-1268. Expected /tmp/task-1268-round-resolution.md and /tmp/task-1268-review-disposition.txt.
---
ℹ duration_ms 104145.013916

✖ failing tests:

test at test/e2e-real-agent-smoke.test.js:229:1
✖ real custom-agent launcher smoke: opencode draft produces a parseable MISSION.md (SC3/SC4/SC5/SC6/SC7) (1696.137119ms)
  AssertionError [ERR_ASSERTION]: [local-model-environment] Cannot run the real custom-agent smoke test: opencode binary not found on PATH. Install opencode and configure the pinned local model before running this gate.
  This blocking gate requires a workstation with opencode installed and the pinned local model (vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit) configured and reachable. See docs/real-agent-smoke.md.
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1359/test/e2e-real-agent-smoke.test.js:232:12)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.start (node:internal/test_runner/test:1096:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:385:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: undefined,
    operator: 'fail',
    diff: 'simple'
  }
[FAIL] Push to review provider failed: verification gate failed for /home/magnus/code/parallix-task-1359 with exit code 1
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
