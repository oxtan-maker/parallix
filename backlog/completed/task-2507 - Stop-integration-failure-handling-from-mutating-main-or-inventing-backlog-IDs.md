---
id: TASK-2507
title: Stop integration failure handling from mutating main or inventing backlog IDs
status: done
assignee: [claude]
created_date: '2026-09-14 09:36'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/adapters/cli/commands/integrate-gate-rebound.ts
  - test/task-2492-integration-gate-rebound.test.ts
ordinal: 74006
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2492 (commit 91b42b3a6) introduced createMainlineGateTask in src/adapters/cli/commands/integrate-gate-rebound.ts. When a gate also fails in the primary checkout, px integrate writes and commits a TASK-MAINGATE-* Markdown file directly on main. This violates the backlog ID/schema authority, mutates the protected shared branch during a failed integration, and strands the originating mission instead of giving an operator a safe, truthful recovery path.

Remove automatic backlog-file creation and git commits from gate-failure routing. A failed integration may report evidence and stop or use the existing numeric Backlog.md workflow through an explicitly authorized command, but it must never fabricate task identifiers or mutate main as a side effect. Preserve mission-regression bounceback and bounded retries.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A mainline-reproduced gate failure creates and commits no files in the base worktree
- [ ] #2 Integration failure handling never constructs TASK-MAINGATE identifiers or hand-renders backlog Markdown
- [ ] #3 Mission-only gate failures still bounce through the existing bounded rebound path
- [ ] #4 Regression coverage proves the base worktree remains byte-for-byte and git-status clean
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
