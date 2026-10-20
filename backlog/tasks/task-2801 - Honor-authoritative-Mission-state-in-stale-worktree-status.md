---
id: TASK-2801
title: Honor authoritative Mission state in stale worktree status
status: backlog
assignee: []
created_date: '2026-10-20 18:49'
labels:
  - bug
dependencies: []
priority: high
ordinal: 280008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Root px status reports started DB-owned worktrees as stale task:missing and prints landed cleanup advice when their Backlog task mirror is absent. Read-only 2026-10-20 observation: px-0016 active139 owner869738 and task-2784 active118 owner1279584 were live in SQLite workflow_operations while overview classified missing files as stale. No cleanup performed. Existing backlog search found no matching ticket. Owner src/adapters/cli/commands/status-adapter.ts:58-93 only reads findTaskFile/getTaskStatus; createStatusStaleWorktreesAdapter has no authoritative Mission lookup; src/composition/cli-read-commands.ts:51 supplies none. Existing owning unit status-adapter.test.ts currently expects missing mirrors to be stale without a recorded Mission. Resolve through existing typed read ports/composition authority.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused regression in the existing status adapter or application owner fails on parent: authoritative live active/review/integration Missions with missing task mirrors never receive stale cleanup hints.
- [ ] #2 Preserve legitimate landed or closed worktree cleanup diagnostics and explicit-slug behavior; absent or failed authoritative lookup must report uncertainty without inventing safe cleanup.
- [ ] #3 Exercise root px status against isolated DB-owned Mission/worktree fixtures; preserve operator data, gates, deadlines and cleanup safety.
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
