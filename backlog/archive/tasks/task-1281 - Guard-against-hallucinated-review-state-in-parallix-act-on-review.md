---
id: TASK-1281
title: Guard against hallucinated review state in parallix act-on-review
status: backlog
assignee: []
created_date: '2026-06-13 17:21'
updated_date: '2026-06-15 20:39'
labels:
  - workflow
  - parallix
  - review
  - guardrail
milestone: parallix workflow guardrails
dependencies: []
priority: medium
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a workflow guardrail so act-on-review validates live Forgejo review comments against the local review state and refuses to trust hallucinated reviewer/phase/disposition claims without evidence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 act-on-review compares live Forgejo review comments with local review-state before applying findings
- [ ] #2 stale or contradictory reviewer/phase/disposition claims are classified as stale instead of actionable
- [ ] #3 the workflow emits a clear warning when review-state and live comments disagree
- [ ] #4 a regression test covers a hallucinated review-state scenario in the parallix workflow
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Docs updated when workflow behavior changes
- [ ] #2 Relevant tests pass
<!-- DOD:END -->
