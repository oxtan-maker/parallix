---
id: TASK-1368
title: 'TASK-1368: Mission 4 - Core utilities (mission-utils, verification)'
status: backlog
assignee: []
created_date: '2026-06-27 10:37'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the 2 core utility modules that handle mission lifecycle operations and verification gates. These are mid-sized files with good JSDoc coverage.

**Files renamed `.js` → `.ts`:**
- `lib/core/mission-utils.js` (1027 lines) — mission directory management, worktree ops, merge conflict detection, checkpoint handling. **Largest non-command file.**
- `lib/core/verification.js` (149 lines) — verification gate execution and reporting

**Conversion details:**
- Replace `require()` with ES `import`
- Replace `module.exports` with ES `export`
- Add `@type` annotations where JSDoc is present (these files have good JSDoc coverage)
- Define TypeScript interfaces for mission state, checkpoint structures, and verification results
- `mission-utils.js` has injectable dependencies (gitRunner, fsModule, pathModule) — preserve this pattern

**Dependency:** Depends on TASK-1365 (infrastructure) and TASK-1366 (core foundation).
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
