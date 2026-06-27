---
id: TASK-1370
title: 'TASK-1370: Mission 6 - Workflow commands (draft, active, checkpoint, handoff)'
status: backlog
assignee: []
created_date: '2026-06-27 10:37'
updated_date: '2026-06-27 10:38'
labels: []
dependencies:
  - TASK-1369
  - TASK-1371
  - TASK-1366
  - TASK-1367
  - TASK-1368
  - TASK-1372
  - TASK-1373
  - TASK-1374
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the 4 main mission lifecycle commands. These are the heaviest command files with the most dependencies across all subsystems.

**Files renamed `.js` → `.ts`:**
- `lib/commands/draft.js` (1002 lines) — create mission branch + worktree. Imports: active, agents, core/*, gitignore, state-map, verification, crypto, fs, path, stats, tools/backlog
- `lib/commands/active.js` (626 lines) — launch agent in mission worktree. Imports: handoff, mission-start, repair-handoff, stats, agents, core/*, review, tools/backlog
- `lib/commands/checkpoint.js` — verify, commit, push checkpoint
- `lib/commands/handoff.js` (573 lines) — sync, push, transition to review. Imports: review/rebase, review/review-state, tools/backlog, forgejo, gatekeeper, setup-review

**Conversion details:**
- Replace `require()` with ES `import` from converted modules
- Replace `module.exports` with ES `export`
- Preserve JSDoc annotations
- Internal command imports must use relative paths (e.g., `import { handoff } from './handoff.js'`)
- `draft.js` and `active.js` are the largest files — pay attention to their complex dependency chains

**Dependency:** Depends on TASK-1369 (simple commands), TASK-1371 (integration commands), and all core/agents/review/tools missions.
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
