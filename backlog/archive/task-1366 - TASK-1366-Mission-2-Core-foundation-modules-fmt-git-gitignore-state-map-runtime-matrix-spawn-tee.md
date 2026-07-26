---
id: TASK-1366
title: >-
  TASK-1366: Mission 2 - Core foundation modules (fmt, git, gitignore,
  state-map, runtime-matrix, spawn-tee)
status: done
assignee:
  - custom
created_date: '2026-06-27 10:37'
updated_date: '2026-06-28 12:20'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the 6 core modules that have ZERO internal lib/ dependencies. These are leaf nodes in the dependency graph — they only use Node.js built-in modules. Converting these first enables all downstream missions.

**Files renamed `.js` → `.ts`:**
- `lib/core/fmt.js` (206 lines) — colorized output, status formatting, ANSI stripping
- `lib/core/git.js` (119 lines) — git CLI wrapper, branch/status/rebase detection
- `lib/core/gitignore.js` (110 lines) — gitignore pattern management
- `lib/core/state-map.js` (89 lines) — virtual state to command mapping
- `lib/core/runtime-matrix.js` (82 lines) — agent/runtime configuration
- `lib/core/spawn-tee.js` (173 lines) — child process spawning with stdout/stderr tee

**Conversion details:**
- Replace `require()` with ES `import` (only Node.js builtins needed)
- Replace `module.exports` with ES `export`
- Add `@type` annotations where JSDoc is sparse (these files have minimal JSDoc)
- Export types/interfaces for any return shapes that other modules consume

**Dependency:** Depends on TASK-1365 (infrastructure) being complete.
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
