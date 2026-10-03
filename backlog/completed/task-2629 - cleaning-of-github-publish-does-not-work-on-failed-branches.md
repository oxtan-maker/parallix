---
id: TASK-2629
title: cleaning of github-publish does not work on failed branches
status: done
assignee: [claude]
created_date: '2026-10-01 18:21'
labels: []
dependencies: []
ordinal: 151008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
One actual release-pipeline hygiene bug
I found 11 live github-publish/<sha> branches dating back as far as September 19, despite cleanup-verification-ref.yml describing these as ephemeral and deleting the verification ref after a main push.
The reason is visible from the cleanup design: it only deletes github-publish/$GITHUB_SHA for a SHA that reaches main. Candidates that don't follow that exact lifecycle survive.
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
