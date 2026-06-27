---
id: TASK-1371
title: >-
  TASK-1371: Mission 7 - Integration & review commands (integrate, rebase,
  resolve-conflict, review)
status: backlog
assignee: []
created_date: '2026-06-27 10:37'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the 4 integration-focused commands. These handle squash-merging, rebasing, conflict resolution, and review delegation.

**Files renamed `.js` → `.ts`:**
- `lib/commands/integrate.js` (1567 lines) — squash-merge reviewed mission. **Single largest file in the codebase.** Imports: core/*, runtime-matrix, state-map, verification, review/review-state, tools/backlog, forgejo
- `lib/commands/rebase.js` (624 lines) — rebase mission onto main. Imports: agents, core/*, integrate (internal), review/review-state, tools/backlog, forgejo
- `lib/commands/resolve-conflict.js` — detect merge conflicts. Imports: agents, core/*, integrate (internal)
- `lib/commands/review.js` (13 lines) — delegates to review-commands. Imports: review/review-commands

**Conversion details:**
- Replace `require()` with ES `import` from converted modules
- Replace `module.exports` with ES `export`
- Preserve JSDoc annotations
- `integrate.js` is the largest file — handle its complexity carefully
- `rebase.js` imports `integrate.js` internally — both converted in this mission
- `resolve-conflict.js` imports `integrate.js` internally

**Dependency:** Depends on TASK-1366, TASK-1367, TASK-1368 (core), TASK-1372 (agents), TASK-1373 (review), TASK-1374 (tools).
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
