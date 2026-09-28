---
id: TASK-2601
title: Use Mission classification for preflight and stage stats
status: backlog
assignee: []
created_date: '2026-09-28 04:17'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 132008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mission classification is stored in the Mission database, but startup preflight and stage statistics still require a classification label in the Backlog task file. This blocked task-2599 after a successful draft. See the task for reproduction and acceptance criteria.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A regression reproduces task-2599: Mission classification user_value, Backlog labels empty, draft succeeds, and px active startup preflight passes.
- [ ] #2 Draft and later stage measurements read classification from authoritative Mission state and record rows without requiring a mirrored Backlog label.
- [ ] #3 A conflicting or missing Backlog label never overrides a valid Mission classification; a missing or invalid Mission classification gets a clear failure.
- [ ] #4 Audit remaining classification consumers in the lifecycle and remove stale provider-file reads under the post-2521.03 database authority.
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
