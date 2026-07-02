---
id: TASK-1400
title: js->ts bugs
status: backlog
assignee: []
created_date: '2026-07-02 04:05'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
},"cost":0}}
[PASS] Execute safety harness: no uncommitted mission changes left behind.
[INFO] 
[INFO] Execute agent (custom) completed successfully. Recording execute-phase stats...
[INFO] 
[INFO] Execute agent (custom) completed successfully. Starting automated handoff...
[PASS] Found 4 checkpoint document(s) in /home/magnus/code/parallix-task-1390/missions/task-1390.
[FAIL] The final checkpoint at missions/task-1390/CP-4.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.

Automated handoff failed: The final checkpoint at missions/task-1390/CP-4.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.
Attempting post-execute repair...
[FAIL] repairHandoffFn is not a function

last row seems to be a ts problem, find all such errors in the code and fix them
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
