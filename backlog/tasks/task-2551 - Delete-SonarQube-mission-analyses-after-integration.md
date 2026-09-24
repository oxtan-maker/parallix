---
id: TASK-2551
title: Delete SonarQube mission analyses after integration
status: backlog
assignee: []
created_date: '2026-09-21 14:50'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 88008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After a mission is confirmed integrated, remove its SonarQube Cloud branch analysis so long-lived mission analyses do not accumulate. Do not delete analysis for a failed, closed, or merely reviewed mission. Also manually delete SonarQube Cloud branch analysis for missions already integrated.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A confirmed integration deletes exactly the matching mission branch analysis from SonarQube Cloud.
- [ ] #2 Failed, closed, and review-only missions retain their SonarQube analysis.
- [ ] #3 A deletion failure is surfaced without changing the confirmed integration result.
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
