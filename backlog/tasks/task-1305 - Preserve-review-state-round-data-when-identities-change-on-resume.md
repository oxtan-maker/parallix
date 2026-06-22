---
id: TASK-1305
title: Preserve review-state round data when identities change on resume
status: backlog
assignee: []
created_date: '2026-06-14 15:00'
updated_date: '2026-06-15 20:39'
labels:
  - workflow
  - parallix
  - review
  - bug
dependencies: []
references:
  - /home/magnus/code/visualBoard-task-1299/parallix/lib/review/review-loop.js
  - /home/magnus/code/visualBoard-task-1299/parallix/lib/review/review-state.js
priority: medium
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The review loop currently rebuilds `ReviewState` from scratch when the persisted reviewer or implementer does not exactly match the identities selected for the current launch. That can drop the existing round number, startedAt, or phase history on a legitimate fallback/resume path. Preserve the persisted round state and only update the identities through the explicit fallback path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Resuming a mission with an existing review-state file preserves the original round number and startedAt
- [ ] #2 A fallback or re-launch that changes reviewer/implementer identities does not reset the persisted phase history
- [ ] #3 The explicit fallback path still updates the stored identities when an agent launcher truly changes families
- [ ] #4 A regression test covers a persisted state resume where the current identities differ from the stored identities
<!-- AC:END -->
