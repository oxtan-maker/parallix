---
id: TASK-2396
title: Reset mission base branch when px draft starts
status: backlog
assignee: [codex]
created_date: '2026-08-22 15:43'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/adapters/cli/commands/draft-stats.ts
  - src/adapters/cli/commands/draft-setup.ts
  - src/adapters/git/worktree.ts
  - test/draft.test.ts
priority: medium
ordinal: 108917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px draft derives the launch base before setup, but a primary-branch launch is represented as no feature base and the current MISSION.md writer treats that value as a no-op. Re-drafting an existing mission can therefore retain a stale Base-Branch header and fail before the backlog transition, as task-2389 did after friday-08-21 disappeared. Make draft startup establish the current launch base for every invocation before downstream mission lifecycle work consumes it. Keep MISSION.md as durable metadata, but do not make documentation scaffolding the operation that decides whether stale base state survives.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Re-running px draft from the primary branch replaces or removes an existing stale feature Base-Branch value so resolveMissionBaseBranch returns main before the backlog transition.
- [ ] #2 Re-running px draft from a non-primary branch records that launch branch, replacing any previous primary or feature base value before downstream lifecycle work consumes it.
- [ ] #3 A focused regression test reproduces an existing mission with Base-Branch: friday-08-21, launches draft from main, and proves the stale branch cannot cause integration-branch resolution to fail.
- [ ] #4 New mission branch creation and existing mission worktree reuse retain their current behavior apart from correcting the resolved base branch.
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
