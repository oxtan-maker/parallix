---
id: TASK-1374
title: >-
  TASK-1375: Mission 11 - Entry points (index.js, px.js) + enable and fix all
  TypeScript errors
status: refined
assignee: [custom]
created_date: '2026-06-27 10:38'
updated_date: '2026-06-27 10:38'
labels:
  - ai_sdlc
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

**No-committed-`.js` guardrails (apply the canonical version in TASK-1364) — root entry points, with extra care:**
- Faithful rename: `index.js → index.ts`, `px.js → px.ts` in place (`git diff -M` ≥ 50%); `git rm --cached index.js px.js`. **`package.json` `main: "index.js"` and `bin.px: "px.js"` keep pointing at the compiled output** — these compiled root files must exist at runtime and ship in the package (they are already in `files`). Do not change `main`/`bin`.
- **`build:cjs` currently only compiles `lib/**/*.ts`** (tsconfig `include: ["lib/**/*.ts"]`). This wave must extend compilation to the root entry points (add `index.ts`/`px.ts` to tsconfig `include`, or to `build:cjs`) so `npm run build:cjs`/`prepublishOnly` regenerate `index.js`/`px.js`. Verify `npm pack --dry-run | grep -E '^npm notice .*(index|px)\.js'` lists them.
- **`.gitignore`:** add root-anchored `/index.js` and `/px.js` (anchored so only the root entry artifacts are ignored, not `lib/.../index.js`). Keep them in `package.json` `files`.
- **ESLint flat-config migration is the critical gotcha:** once `.eslintrc.cjs` becomes `eslint.config.mjs`, **`.eslintignore` is no longer read.** Port every ignore + `!` negation from `.eslintignore` (all `lib/<dir>/*.js` compiled-output globs, plus `dist/`, `node_modules/`, root `index.js`/`px.js`) into the flat config's `ignores` (later entries override earlier, which is how you re-include any still-hand-written `.js`). After this wave the whole codebase should be `.ts`, so the `!` negations should largely disappear and `ignores` can be the compiled-output globs.
- **Update the static-analysis gate:** `scripts/verify-local.sh` runs `npx eslint --ext .js ... lib/`; `--ext` is ignored under flat config. Update the gate to lint the `.ts` sources (and rely on flat-config `ignores` to skip compiled output) so the gate stays meaningful. Confirm `./scripts/verify-local.sh static-analysis` passes **with compiled `.js` present on disk**.
- Gates: `git ls-files index.js px.js` empty and no `lib/**/*.js` source tracked (only compiled artifacts, all gitignored); `node px.js --help` (or equivalent) runs from the compiled output; `require('./index.js')` resolves the barrel exports.

**Verification:**
- Run `npm test` — all tests must pass at baseline counts
- Run `tsc --noEmit` — zero errors
- Run `eslint` (flat config) — zero errors, compiled output ignored
- Run `npm run build` — successful compilation
- Run `npm run prepublishOnly` — successful compilation (simulates npm publish), regenerates root + lib `.js`

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
