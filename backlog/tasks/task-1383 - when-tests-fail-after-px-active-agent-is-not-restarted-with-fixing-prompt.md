---
id: TASK-1383
title: when tests fail after px active agent is not restarted with fixing prompt
status: backlog
assignee: []
created_date: '2026-06-28 05:48'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
add to use case: as an engineer I want parallix to automatically ask agents to fix states if parallix discovers that state is not properly implemented. Example: when tests fail after active 

ass 1715
ℹ fail 14
ℹ cancelled 0
ℹ skipped 22
ℹ todo 0
ℹ duration_ms 11724.942457

✖ failing tests:

test at test/forgejo-independence.test.js:68:1
✖ mission-start accepts isForgejoReviewEnabledFn option and skips PR check when false (63.875385ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at missionStart (/home/magnus/code/parallix-task-1368/lib/commands/mission-start.js:188:33)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/forgejo-independence.test.js:73:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/forgejo-independence.test.js:358:1
✖ printIntegrationPreflight does not call Forgejo API helpers when context indicates provider off (63.023051ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at printIntegrationPreflight (/home/magnus/code/parallix-task-1368/lib/commands/integrate.js:1018:44)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/forgejo-independence.test.js:402:3)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/mission-start.test.js:7:1
✖ missionStart fails if the backlog task is missing classification (12.355159ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at missionStart (/home/magnus/code/parallix-task-1368/lib/commands/mission-start.js:188:33)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/mission-start.test.js:11:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.start (node:internal/test_runner/test:1096:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:385:17)

test at test/mission-start.test.js:37:1
✖ missionStart passes if the backlog task has classification (6.017892ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at missionStart (/home/magnus/code/parallix-task-1368/lib/commands/mission-start.js:188:33)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/mission-start.test.js:41:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3)

test at test/mission-start.test.js:65:1
✖ missionStart passes when the task file is missing and classification falls back to unknown (6.621652ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at missionStart (/home/magnus/code/parallix-task-1368/lib/commands/mission-start.js:188:33)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/mission-start.test.js:69:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/mission-start.test.js:127:1
✖ missionStart passes if classification is provided via labels (39.08484ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at missionStart (/home/magnus/code/parallix-task-1368/lib/commands/mission-start.js:188:33)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/mission-start.test.js:176:19)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/mission-start.test.js:191:1
✖ missionStart fails if the mission is already complete (9.976831ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at missionStart (/home/magnus/code/parallix-task-1368/lib/commands/mission-start.js:188:33)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/mission-start.test.js:193:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/rebase_diagnostics.test.js:100:1
✖ task-1322 recovery diagnostics report an in-progress rebase across status, rebase, and integrate preflight (17.426547ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at printIntegrationPreflight (/home/magnus/code/parallix-task-1368/lib/commands/integrate.js:1018:44)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/rebase_diagnostics.test.js:172:20)
      at async Test.run (node:internal/test_runner/test:1208:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/task-1039-integrate-v3.test.js:10:1
✖ printIntegrationPreflight branch failure (17.570505ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at printIntegrationPreflight (/home/magnus/code/parallix-task-1368/lib/commands/integrate.js:1018:44)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/task-1039-integrate-v3.test.js:25:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.start (node:internal/test_runner/test:1096:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:385:17)

test at test/task-1039-integrate-v3.test.js:34:1
✖ printIntegrationPreflight mission-doc failure (19.429322ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at printIntegrationPreflight (/home/magnus/code/parallix-task-1368/lib/commands/integrate.js:1018:44)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/task-1039-integrate-v3.test.js:49:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:385:3)

test at test/task-1039-integrate-v3.test.js:58:1
✖ printIntegrationPreflight task failures (17.564735ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at printIntegrationPreflight (/home/magnus/code/parallix-task-1368/lib/commands/integrate.js:1018:44)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/task-1039-integrate-v3.test.js:73:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/task-1039-integrate-v3.test.js:90:1
✖ printIntegrationPreflight PR approval failures (18.842793ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at printIntegrationPreflight (/home/magnus/code/parallix-task-1368/lib/commands/integrate.js:1018:44)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/task-1039-integrate-v3.test.js:106:16)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/task-1039-integrate-v3.test.js:123:1
✖ printIntegrationPreflight main-index-conflict-check failure (16.943596ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at printIntegrationPreflight (/home/magnus/code/parallix-task-1368/lib/commands/integrate.js:1018:44)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/task-1039-integrate-v3.test.js:138:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)

test at test/task-1039-integrate-v3.test.js:147:1
✖ printIntegrationPreflight main-dirty warning (15.63759ms)
  Error: Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.
      at getPrimaryBranch (/home/magnus/code/parallix-task-1368/lib/core/mission-utils.js:184:11)
      at printIntegrationPreflight (/home/magnus/code/parallix-task-1368/lib/commands/integrate.js:1018:44)
      at TestContext.<anonymous> (/home/magnus/code/parallix-task-1368/test/task-1039-integrate-v3.test.js:162:18)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1201:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:831:18)
      at Test.postRun (node:internal/test_runner/test:1330:19)
      at Test.run (node:internal/test_runner/test:1258:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:831:7)
[FAIL] Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.

Do some deep thinking and intventorize all the state transitions and what guards and automatic fixes (prompts) exists today and fix the diff.
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
