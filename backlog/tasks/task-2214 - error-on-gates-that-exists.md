---
id: TASK-2214
title: error on gates that exists
status: backlog
assignee: []
created_date: '2026-07-11 04:10'
updated_date: '2026-07-11 06:06'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
remote: 
To http://localhost:3300/magnus/parallix.git
   e3f487e18..11d1b07cb  mission/task-2210 -> mission/task-2210
[INFO] PR already exists: http://localhost:3300/magnus/parallix/pulls/127
[INFO] Step 2.5: Running gatekeeper pre-review validation...
[INFO] [INFO] Gatekeeper: all mandatory artifacts present for task-2210.
[INFO] Gatekeeper: all mandatory artifacts present.
[INFO] Step 2.6: Running declared gates from MISSION.md...
[INFO]   Gate: `./scripts/verify-local.sh all` passes on the final tree.
[FAIL] Declared gate "`./scripts/verify-local.sh all` passes on the final tree." failed for task-2210: bash: rad 1: >: kommandot finns inte. Blocking handoff — task remains in active.
Automated handoff failed: Gate failure persisting after 2 relaunch attempts. Manual intervention required.
       You may need to complete the handoff manually:
       px review task-2210 --submit

The problem was that the draft created a mission with gates that could not be executed by a machine, fix was

   70  ## Gates
      71 -- [ ] `./scripts/verify-local.sh all` passes on the final tree.                                                                                                                            
      72 -- [ ] Relevant automated help-output tests pass and name the asserted `px`, `draft`, and `active` implementer-help behavior.                                                               
      73 -- [ ] No focused (`.only`) or unannotated skipped tests are introduced.                                                                                                                    
      71 +- [ ] ./scripts/verify-local.sh all                                                                                                                                                        
      72 +- [ ] node --test test/index.test.js  

ensure this does not happen

even the e2e gates fail at the moment
=== PASS: integration:workflow ===
=== GATE: integration:custom-agent-smoke ===
Command: node test/e2e-real-agent-smoke.test.js
[benchmark] runner=opencode phase=draft duration_ms=142737 provider=opencode model=QuantTrio/Qwen3.6-27B-AWQ-6Bit input_tokens=121028 tool_calls=12
TAP version 13
# Subtest: real custom-agent launcher smoke (opencode): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)
not ok 1 - real custom-agent launcher smoke (opencode): full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)
  ---
  duration_ms: 1356761.76213
  type: 'test'
  location: '/home/magnus/code/parallix-task-2215/test/e2e-real-agent-smoke.test.js:756:1'
  failureType: 'testCodeFailure'
  error: |-
    [parallix-workflow-failure] px active --implementer custom failed (status=null): [FAIL] The final checkpoint at missions/task-9001/CP-1.md has a "## Goal Check" section but no evidence rows that cite a verifiable reference such as a file:line, ADR, test reference, or recognized repo command/path. A goal-check table with real evidence is required before handoff. Offending row: | SC2: `bash hello.sh` prints exactly `Hello, World!` | `bash hello.sh` outputs `Hello, World!` (no extra whitespace or lines) | PASS |
    [FAIL] The final checkpoint at missions/task-9001/CP-1.md has a "## Goal Check" section but no evidence rows that cite a verifiable reference such as a file:line, ADR, test reference, or recognized repo command/path. A goal-check table with real evidence is required before handoff. Offending row: | SC2: `bash hello.sh` prints exactly `Hello, World!` | `bash hello.sh` | PASS |
    
    
    null !== 0
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 0
  actual: ~
  operator: 'strictEqual'
  stack: |-
    runRealAgentSmoke (/home/magnus/code/parallix-task-2215/test/e2e-real-agent-smoke.test.js:678:12)
    TestContext.<anonymous> (/home/magnus/code/parallix-task-2215/test/e2e-real-agent-smoke.test.js:761:3)
    Test.runInAsyncScope (node:async_hooks:214:14)
    Test.run (node:internal/test_runner/test:1047:25)
    Test.start (node:internal/test_runner/test:944:17)
    startSubtestAfterBootstrap (node:internal/test_runner/harness:296:17)
  ...
1..1
# tests 1
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
