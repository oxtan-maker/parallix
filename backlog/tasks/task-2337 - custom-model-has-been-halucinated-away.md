---
id: TASK-2337
title: custom model has been halucinated away
status: ready-for-integration
assignee:
  - custom
created_date: '2026-08-04 06:28'
updated_date: '2026-08-08 07:38'
labels:
  - user_value
  - bug
dependencies: []
ordinal: 82900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
current stats does not show model for custom:

Agent performance this week (2026-07-29 → 2026-08-04)
Agent family   # missions as implementer  Average PR fix rounds to complete mission  
claude-opus-5  5                          2.00                                       
custom         8                          1.25                                       
gpt-5.6-terra  14                         0.57       

fix this bug so we see the exact model used, reimport the stats file from PARALLIX_HOME old file stats so historical stats that can be recored is
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
