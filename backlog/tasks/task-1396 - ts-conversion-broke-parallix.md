---
id: TASK-1396
title: ts conversion broke parallix
status: backlog
assignee: []
created_date: '2026-07-01 06:09'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
magnus@debian:~/code/parallix-task-1395$ node px.ts active
(node:238250) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///home/magnus/code/parallix-task-1395/px.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /home/magnus/code/parallix-task-1395/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
[INFO] Running execute preflight...
[FAIL] missionStartFn is not a function
magnus@debian:~/code/parallix-task-1395$ px active
[INFO] Running execute preflight...
[FAIL] missionStartFn is not a function
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
