---
id: TASK-1402
title: ensure px is updated as global runner
status: backlog
assignee: []
created_date: '2026-07-02 04:30'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
I have a problem that the globally installed px is very out of date relative to the code version since missions change the code frequently.

Ensure the px has a general post-integrate hook that can be used in any repo, then wire this hook into a parallix specific post-intregrate hook that bumps the patch version and does a local install (npm update -g) after a successful integraton.
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
