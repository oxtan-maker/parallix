---
id: TASK-2214
title: error on gates that exists
status: backlog
assignee: []
created_date: '2026-07-11 04:10'
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
