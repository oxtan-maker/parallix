---
id: TASK-1407
title: review not rebased to main
status: backlog
assignee: []
created_date: '2026-07-02 18:33'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
a thorough investigation in task-1403 showed that rebase main is done at each review loop so that is not the cause of the major amount of "branch reverting stuff due to not rebased to main" review comments. Most likely problem is then that while the review loop is running another mission gets integrated. Change the review (and act-on-review) prompts to not diff against main w.r.t. the branch but the actual commit main was on when the step was started
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
