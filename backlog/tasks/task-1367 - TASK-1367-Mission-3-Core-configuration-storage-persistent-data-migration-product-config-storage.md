---
id: TASK-1367
title: >-
  TASK-1367: Mission 3 - Core configuration & storage
  (persistent-data-migration, product-config, storage)
status: backlog
assignee: []
created_date: '2026-06-27 10:37'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the 3 core modules that handle configuration loading, validation, and persistent data storage. These depend only on Mission 2's leaf modules.

**Files renamed `.js` → `.ts`:**
- `lib/core/persistent-data-migration.js` (209 lines) — data schema migrations
- `lib/core/product-config.js` (515 lines) — workflow config loading, JSON schema validation
- `lib/core/storage.js` (165 lines) — persistent key-value storage layer

**Conversion details:**
- Replace `require()` with ES `import`
- Replace `module.exports` with ES `export`
- Add `@type` annotations where JSDoc is present (these files have good JSDoc coverage)
- Define TypeScript interfaces for config shapes and storage schemas
- `product-config.js` is the largest — it loads `workflow.config.json` and validates against a JSON schema

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
