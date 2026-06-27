---
id: TASK-1365
title: 'TASK-1365: Mission 1 - TypeScript infrastructure setup'
status: done
assignee: []
created_date: '2026-06-27 10:37'
labels: [ai_sdlc]
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up TypeScript tooling, configuration, and build scripts for the Parallix migration. This is the foundation mission — no other mission can proceed until this is complete because every subsequent task depends on the tsconfig and package.json being in the correct state.

**Files modified:**
- `tsconfig.json` (rewrite)
- `package.json` (scripts + devDependencies)
- `.npmignore` (exclude `.ts` from npm ignore)

**Changes:**
- Rewrite `tsconfig.json`: `allowJs: false`, `checkJs: false`, `noEmit: false`, `outDir: "."`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `target: ES2024`, `exclude: ["test/", "graphify-out/", ".forgejo-local/"]`
- Add `build` script: `tsc`
- Add `prepublishOnly` script: `tsc`
- Add `typecheck` script: `tsc --noEmit`
- Add `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` to devDependencies
- Update `.npmignore` to not exclude `.ts` files (they ship alongside `.js`)

**Why this matters:** The existing `tsconfig.json` only does `allowJs: true, checkJs: true, noEmit: true` on a subset of files. This mission flips it to full TypeScript emission mode so all subsequent conversions compile correctly.
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
