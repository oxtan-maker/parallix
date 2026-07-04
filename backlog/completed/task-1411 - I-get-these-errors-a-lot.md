---
id: TASK-1411
title: I get these errors a lot
status: done
assignee: [claude]
created_date: '2026-07-03 06:50'
labels: [user_value, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
[PASS] Pre-review gate passed for area "static-analysis".
[INFO] Round 2: launching reviewer (custom)...
[WARN] Could not inspect git worktrees while looking for main-worktree agents.local.json; skipping that lookup (git exited with status 128).
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
