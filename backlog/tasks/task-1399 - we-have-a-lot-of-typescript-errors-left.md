---
id: TASK-1399
title: we have a lot of typescript errors left
status: backlog
assignee: []
created_date: '2026-07-01 21:43'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Fix all remaining typescript errors, example:

------|\n| `npm test` passes with 0 failures | ✓ 1770 tests, 1748 pass, 0 fail |\n| `test/px-runner.test.js` has zero `px.js` references | ✓ 0 matches |\n| `test/px-shell-init.test.js` imports from `px.ts` with `--experimental-strip-types` | ✓ Confirmed |\n| `px.ts` exports `shellInit` and `parseArgs` when imported as ESM | ✓ Verified |\n| `node px.ts --version` triggers `run()` | ✓ Verified |\n| `node px.js --version` still works (CJS compat) | ✓ Verified |\n| All checkpoint documents committed | ✓ Working tree clean |\n| Mission gates pass | ✓ `npm test` passes |\n\nMission task-1395 complete. All 4 checkpoints delivered, all gates passing, all changes committed. Ready for handoff to review.","time":{"start":1782941940799,"end":1782941944234}}}
{"type":"step_finish","timestamp":1782941944264,"sessionID":"ses_0e0b5a549ffekUa7jJhKOxxvCR","part":{"id":"prt_f1f9f09c5001Ldyzoi7hmBHLub","reason":"stop","snapshot":"d50bde16bff4a6b14dd3c11d1d8707ca31944a92","messageID":"msg_f1f9ef9d8001CjBupnbfVgeOlh","sessionID":"ses_0e0b5a549ffekUa7jJhKOxxvCR","type":"step-finish","tokens":{"total":119590,"input":119291,"output":299,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0}}
[PASS] Execute safety harness: no uncommitted mission changes left behind.
[INFO] 
[INFO] Execute agent (custom) completed successfully. Recording execute-phase stats...
[INFO] 
[INFO] Execute agent (custom) completed successfully. Starting automated handoff...
[PASS] Found 4 checkpoint document(s) in /home/magnus/code/parallix-task-1395/missions/task-1395.
[FAIL] The final checkpoint at missions/task-1395/CP-4.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.

Automated handoff failed: The final checkpoint at missions/task-1395/CP-4.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.
Attempting post-execute repair...
[FAIL] repairHandoffFn is not a function
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
