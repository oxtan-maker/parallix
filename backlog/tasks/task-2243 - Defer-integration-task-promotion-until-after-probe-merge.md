---
id: TASK-2243
title: Defer integration task promotion until after probe merge
status: backlog
assignee: []
created_date: '2026-07-13 05:38'
labels:
  - bug
  - integration
dependencies: []
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Root cause

`px integrate` promotes a review-approved backlog task in the primary integration checkout after preflight but before the Variant B `merge --no-commit` probe. That promotion dirties the same task file the probe merge may touch. When the probe cannot safely start or abort, it can leave unmerged index entries; subsequent `px rebase` then misclassifies the resulting state, while integration correctly rejects the dirty overlapping closeout path.

This occurred during task-2213 and is related to task-2242’s report of primary-branch backlog changes racing integration.

## Desired outcome

Do not mutate the primary checkout until the probe merge has been cleanly aborted and the squash merge is established. Preserve the automatic review-to-approved promotion as part of the eventual landed closeout.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A review-approved task is not promoted before the Variant B probe merge has been successfully aborted
- [ ] #2 A successful Variant B integration still promotes and completes a review-approved task in its landed commit
- [ ] #3 A regression test proves no task-status mutation occurs when probe-merge abort fails
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
