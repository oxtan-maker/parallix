---
id: TASK-2625
title: wrong visualization of state
status: done
assignee: [custom]
created_date: '2026-10-01 12:00'
labels: []
dependencies: []
ordinal: 148008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
when we have a rebounce from integraiton, after its resolved even when the new integration tests are running it still looks (at least on web) like its in active. It migth be that some check part in active runs the integration tests to validate that active has fixed the issue. In that case its fine, but its not ok that we then have to re-run the whole integration suite again when integrating (but if thats the case we need to be careful so this mission does not hardocode the case when parallix develops itself into the general product), keep the resolution general (like whitelisting higlevel test hooks on sha:s or if not possible do changes in the specific code when parallix develops itself.
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
