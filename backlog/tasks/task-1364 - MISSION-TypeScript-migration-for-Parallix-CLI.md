---
id: TASK-1364
title: 'MISSION: TypeScript migration for Parallix CLI'
status: backlog
assignee: []
created_date: '2026-06-27 10:36'
labels: []
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Convert the entire Parallix codebase from JavaScript to TypeScript. This is a 23K-line, 62-file migration across 5 subsystems (core, commands, agents, review, tools) with 107 existing tests.

**Outcome:** Zero runtime dependencies, fully typed TypeScript codebase with passing tests, ESLint integration, and npm-publishable output.

**Constraints:**
- Ship both `.ts` source and `.js` compiled output (no cleanup step)
- ES module syntax (`import`/`export`) with `module: NodeNext`
- Strict TypeScript checking enabled
- All 107 tests must pass after each mission
- JSDoc-annotated codebase (283+ `@param`/`@returns` annotations) — leverage existing annotations

**Conversion pattern per file:**
1. Rename `.js` → `.ts`
2. Replace `require`/`module.exports` with `import`/`export`
3. Add missing `@type` annotations where JSDoc is sparse
4. Run `tsc --noEmit` to verify
5. Run `npm test` to verify no regression
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
