---
id: TASK-2463
title: make first time usage autodetect and write config
status: backlog
assignee: []
created_date: '2026-09-06 17:40'
labels: [user_value]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
we have a friction point in using parallix in that it by default activates all agents that parallix supports, which will confuse a user a lot if parallix spend 2 min timing out vibe that is not even installed on their system. If parallix is run without a config file, write the (standard) config file to standard location, then configure the eligible agents for all phases depending on what executables are availible in the system.
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
