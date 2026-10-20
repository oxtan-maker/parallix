---
id: TASK-2804
title: Make implementer reassignment recover an existing PR
status: backlog
assignee: []
created_date: '2026-10-20 22:21'
updated_date: '2026-10-20 22:23'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 283008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2784 reproduces an incorrect PR-authorship guard. px review task-2784 --continue changed the authoritative implementer from Codex to Claude, then rebased and pushed the existing Codex-authored PR. The workflow refused to continue because it treated immutable PR authorship as if it had to equal the current implementer. Normal Parallix operation changes implementer and reviewer on an existing PR; the original submitter remains its author. The system must preserve that PR and use the selected independent reviewer rather than blocking on author/implementer mismatch. Existing task and documentation searches found no active or completed owner for this reassignment failure. Preserve the distinct rule that a PR author cannot provide the formal independent approval; do not require PR replacement merely because implementation ownership changes. Cover the public CLI flow with disposable Git, SQLite and Forgejo fixtures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An existing PR remains reviewable after a supported implementer reassignment
- [ ] #2 The reviewer can differ from both the original PR author and the current implementer
- [ ] #3 The original PR author still cannot provide formal independent approval
- [ ] #4 A disposable public CLI regression reproduces the TASK-2784 path red before the fix and green after it
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
