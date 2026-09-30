---
id: TASK-2599
title: npm run dev does not exit on finished operations
status: done
assignee: [codex]
created_date: '2026-09-28 03:54'
labels: []
dependencies: []
ordinal: 130008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
currently operations in parallix that are complete do not return to the terminal, example (but not exastive):

remote: 
To http://localhost:3300/magnus/parallix.git
 + c4c0f2a99...7ff9d021f 7ff9d021f62ec13658a8edac23689804f940ace3 -> mission/task-2593 (forced update)
To http://localhost:3300/magnus/parallix.git
 - [deleted]             mission/task-2593
[INFO] PR #514 (mission/task-2593): remote branch deleted
[INFO] PR #514 (mission/task-2593) marked merged at 7ff9d021f62ec13658a8edac23689804f940ace3
[FAIL] Post-integration workflow stats failed for task-2593: Cannot record integration stats for task-2593: missing classification
[INFO] Next: cd /mnt/data/code/parallix
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
