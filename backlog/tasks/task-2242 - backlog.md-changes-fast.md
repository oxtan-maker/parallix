---
id: TASK-2242
title: backlog.md changes fast
status: backlog
assignee: []
created_date: '2026-07-13 05:35'
labels: []
dependencies: []
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
with backlog.md changes being done in primarybranch the main changes really fast so even during an integration run it can change leading to errors:

=== PASS: integration:custom-agent-smoke ===
[PASS] All integration gates passed.
[INFO] Promoted Backlog status from review to approved because review is already fulfilled.
[INFO] Moving process directory to /home/magnus/code/parallix before mission worktree deletion.
[INFO] Selecting integration variant: Variant B (local squash-merge)
[INFO] 
[INFO] Step 1: Using base worktree /home/magnus/code/parallix on main as the squash-merge target...
[INFO] Step 2: Checking merge conflicts against local main in the base worktree...
[FAIL] Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.

Ensure an integration survives if main has changed mid integration as long as its just backlog.md changes
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
