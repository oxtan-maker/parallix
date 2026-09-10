---
id: TASK-2480
title: make the missing files commit handle all files
status: backlog
assignee: []
created_date: '2026-09-10 10:54'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
currently there is a guard for when an agent forgets to commit a file that autocommits it, unfortunatly there seems to be some halucinated guard there as well. Agents can forget to commit any file, so all files everywhere in any state of parallix needs to handle this and help them out by autocommitting so we don't need human interupption for that.
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
