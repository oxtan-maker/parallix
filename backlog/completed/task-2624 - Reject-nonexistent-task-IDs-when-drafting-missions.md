---
id: TASK-2624
title: Reject nonexistent task IDs when drafting missions
status: done
assignee: [claude]
created_date: '2026-10-01 10:53'
labels:
  - bug
dependencies: []
priority: high
ordinal: 148008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drafting task-2623.04 silently resolved the existing TASK-2623 through a base-ID fallback, creating a duplicate mission with the wrong scope. An explicit task ID must identify that exact task. Stop with a clear missing-task error before launching a drafting agent or creating mission state when it does not exist. Keep supported ad hoc mission creation working; scope the check to inputs interpreted as existing task references.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An explicit nonexistent task ID fails before agent launch, mission intake, branch/worktree creation, or mutation of another task; the error names the requested ID.
- [ ] #2 When TASK-2623 exists but TASK-2623.04 does not, drafting task-2623.04 fails instead of falling back to TASK-2623; a genuinely existing dotted task ID still resolves exactly.
- [ ] #3 Supported free-text, directory-based, and explicit ad hoc drafts still create missions through the existing ad hoc identity allocation path; existing ad hoc missions can still be resumed.
- [ ] #4 A focused regression reproduces the accidental duplicate and verifies exact task lookup alongside supported ad hoc draft behavior.
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
