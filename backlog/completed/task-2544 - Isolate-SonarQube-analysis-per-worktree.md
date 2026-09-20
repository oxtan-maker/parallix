---
id: TASK-2544
title: Isolate SonarQube analysis per worktree
status: done
assignee: [custom]
created_date: '2026-09-20 09:50'
labels:
  - reliability
  - sonarqube
  - workflow
  - ai_sdlc
dependencies: []
priority: high
ordinal: 87008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SonarQube scans from different mission worktrees publish to the shared `parallix` project key. The last scan overwrites the previous mission analysis, so a mission can read findings that belong to another checkout and falsely treat them as its own baseline or completion evidence. Provide an analysis identity and query path that are isolated per worktree or per branch while preserving a separately defined main-branch quality view.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A scan from one mission worktree cannot overwrite the issue results used by another mission worktree.
- [ ] #2 Mission verification queries report the analysis associated with that mission checkout or branch.
- [ ] #3 The main branch retains an explicitly defined quality view.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 Automated coverage demonstrates two distinct worktree or branch analyses remain independently queryable.
- [ ] #8 Existing local SonarQube workflow remains documented and verified.
<!-- DOD:END -->
