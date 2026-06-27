---
id: TASK-1374
title: >-
  TASK-1375: Mission 11 - Entry points (index.js, px.js) + enable and fix all
  TypeScript errors
status: backlog
assignee: []
created_date: '2026-06-27 10:38'
updated_date: '2026-06-27 10:38'
labels: []
dependencies:
  - TASK-1369
  - TASK-1370
  - TASK-1371
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the 2 entry point files and fix all accumulated TypeScript errors across the entire codebase. This is the final mission that ties everything together.

**Files converted:**
- `index.js` (77 lines) — barrel re-export. Re-exports from agents/commands/core/review/tools. Converts to `.ts` with ES exports.
- `px.js` (236 lines) — CLI binary entry point. Imports fmt, mission-start, review-events, workflow, package.json. Heavier file with arg parsing, shell integration, review-event handling.
- `.eslintrc.cjs` → `eslint.config.mjs` — migrate to flat config with `@typescript-eslint`

**TypeScript error fixing (critical):**
After converting all files, run `tsc --noEmit` to surface all type errors. Expected error categories:
- Missing JSDoc `@type` annotations on functions with untyped parameters
- Type mismatches where JDoc types are incorrect or incomplete
- Import/export syntax errors (relative paths needing `.js` extension)
- Module resolution issues with `module: NodeNext`
- Type inference failures where TypeScript cannot infer return types
- Interface/type mismatches between modules

**ESLint migration:**
- Replace `.eslintrc.cjs` with flat config `eslint.config.mjs`
- Use `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`
- Preserve existing rules: no-undef, no-unused-vars, valid-typeof, no-unreachable, no-async-promise-executor, eqeqeq, curly, no-var
- Extend with TypeScript-aware rules

**Verification:**
- Run `npm test` — all 107 tests must pass
- Run `tsc --noEmit` — zero errors
- Run `eslint` — zero errors
- Run `npm run build` — successful compilation
- Run `npm run prepublishOnly` — successful compilation (simulates npm publish)

**Dependency:** Depends on TASK-1369, TASK-1370, TASK-1371 (all commands missions).
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
