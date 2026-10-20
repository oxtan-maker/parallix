---
id: TASK-2804
title: Make implementer reassignment recover an existing PR
status: backlog
assignee: []
created_date: '2026-10-20 22:21'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 283008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2784 reproduces a lifecycle dead end. px review task-2784 --continue --implementer claude changes the authoritative assignee, rebases and pushes the existing Codex-authored PR, then refuses review because PR author Codex differs from implementer Claude. Forgejo PR authorship is immutable. docs/operator-setup.md says the PR must be replaced under the implementer identity, but px exposes no safe replacement command or recovery path, so the documented reassignment feature cannot complete once a PR exists. Existing task and documentation searches found no active or completed owner for PR replacement on implementer reassignment. Preserve fail-closed identity checks and review independence; make the supported reassignment path either replace the PR atomically under the newly assigned implementer, or reject reassignment before mutation with an actionable recoverable operation. Cover the public CLI flow with disposable Git, SQLite and Forgejo fixtures, including no orphaned PR/branch state on failure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A mission with an existing PR can change implementer through a supported px workflow and reach review without bypassing PR authorship or review independence
- [ ] #2 A failed replacement leaves the authoritative assignee, review state, branch and open PR in a recoverable consistent state
- [ ] #3 The public CLI regression is red on the current TASK-2784-shaped path and green with the fix
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
