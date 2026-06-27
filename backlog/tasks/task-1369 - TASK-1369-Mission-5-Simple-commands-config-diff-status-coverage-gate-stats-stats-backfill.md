---
id: TASK-1369
title: >-
  TASK-1369: Mission 5 - Simple commands (config, diff, status, coverage-gate,
  stats, stats-backfill)
status: backlog
assignee: []
created_date: '2026-06-27 10:37'
updated_date: '2026-06-27 10:38'
labels: []
dependencies:
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
Convert the 6 simplest command handlers. These have fewer inter-command dependencies and lighter logic than the workflow/integration commands.

**Files renamed `.js` → `.ts`:**
- `lib/commands/config.js` (2 requires) — print effective configuration
- `lib/commands/diff.js` (5 requires) — branch-vs-main diff tool
- `lib/commands/status.js` (8 requires) — mission/repo overview
- `lib/commands/coverage-gate.js` (5 requires) — coverage gate enforcement
- `lib/commands/stats.js` (12 requires) — usage statistics from CSV
- `lib/commands/stats-backfill.js` (7 requires) — backfill stats data

**Conversion details:**
- Replace `require()` with ES `import` from converted modules in core/agents/review/tools
- Replace `module.exports` with ES `export`
- Preserve JSDoc annotations (these files already have good coverage)
- `stats.js` is the most complex here (12 requires) — it imports from core, agents, review, and tools

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
