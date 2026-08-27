---
id: TASK-2420
title: >-
  Recognize provider approval from the assigned reviewer during integration
  recovery
status: ready-for-integration
assignee: [custom]
created_date: '2026-08-26 16:56'
updated_date: '2026-08-26 16:56'
labels: [ai_sdlc, bug]
dependencies: []
priority: high
ordinal: 121917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integration recovery rejects an active Mission whose Review is already approved unless the Forgejo approval was posted by the hard-coded default user (human). Autonomous review posts the formal approval as the configured reviewer (for example qwen), so a successful provider review plus persisted ReviewerDecision leaves the Mission unintegratable.

Make the recovery authority match the configured reviewer/recorded review identity while preserving fail-closed behavior: a missing, stale, dismissed, superseded, or wrong-reviewer provider approval must not recover the Mission.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An active Mission with an already-approved Review recovers when the current provider review is an APPROVED decision by the reviewer assigned to that Review.
- [ ] #2 The guard still rejects stored approval without a current formal provider approval, and rejects a review by an unrelated user.
- [ ] #3 The provider decision timestamp used for recovery is the qualifying reviewer approval timestamp.
- [ ] #4 Focused unit tests cover qwen-style reviewer approval, wrong-user rejection, and a later request-changes superseding approval.
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
