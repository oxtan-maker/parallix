---
id: TASK-1402
title: ensure px is updated as global runner
status: done
assignee: [claude]
created_date: '2026-07-02 04:30'
labels:
  - ai_sdlc
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
I have a problem that the globally installed px is very out of date relative to the code version since missions change the code frequently.

Ensure the px has a general post-integrate hook that can be used in any repo, then wire this hook into a parallix-specific post-integrate hook that bumps the patch version and does a local install after a successful integration.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after (n/a — not bug-labeled)
<!-- DOD:END -->
