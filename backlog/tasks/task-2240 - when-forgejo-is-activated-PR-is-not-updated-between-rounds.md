---
id: TASK-2240
title: when forgejo is activated PR is not updated between rounds
status: active
assignee: [custom]
created_date: '2026-07-13 03:38'
labels: []
dependencies: []
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Example: http://localhost:3300/magnus/parallix/pulls/138, there is a lot of back an forth between the agents with changes, but the PR shows no source changes being pushed to forgejo at all. Meaning that when final human review is done it always has to first update the PR to actually show the diff
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
