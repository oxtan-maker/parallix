---
id: TASK-2584
title: dependency upgrade
status: backlog
assignee: []
created_date: '2026-09-26 11:19'
labels: []
dependencies: []
ordinal: 115008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
dependabot notes that we have new version of dependencies:

#8
·dependabot[bot] opened yesterday
Bot
·
1
build(deps-dev): bump vite from 7.3.6 to 8.3.0
dependencies

javascript

#7
·dependabot[bot] opened yesterday
Bot
·
1
build(deps-dev): bump react-dom from 19.2.8 to 19.3.0
dependencies

javascript

#6
·dependabot[bot] opened yesterday
Bot
·
1
build(deps-dev): bump fast-uri from 3.1.6 to 4.2.1
dependencies

javascript

#5
·dependabot[bot] opened yesterday
Bot
·
1
build(deps-dev): bump @types/node from 26.0.1 to 26.6.2
dependencies

javascript

#4
·dependabot[bot] opened yesterday
Bot
·

However the depdabot PR does not work automatically, update the dependencies and handle migration work
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
