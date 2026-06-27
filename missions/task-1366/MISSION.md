# Mission: Convert 6 core foundation modules from CJS to ESM/TypeScript (task-1366)

## Goal

Convert the 6 core `lib/core/` modules from CommonJS (`require`/`module.exports`) to ES Module syntax (`import`/`export`) with TypeScript type annotations. Files are renamed `.js` → `.ts`. The 4 truly leaf modules (`fmt`, `git`, `gitignore`, `spawn-tee`) convert directly. The 2 modules with internal dependencies (`state-map`, `runtime-matrix`) convert only after their upstream dependencies are also converted. All conversions preserve runtime behavior, public APIs, and test pass rates.

## Why Now

This is Wave 1 of the repository-wide CJS→ESM migration. These 6 modules sit at the bottom of the dependency graph — they are the lowest-level building blocks that every other module in `lib/` imports. Converting them first removes the CJS barrier for downstream modules, allowing each subsequent conversion mission to import from `.ts` ESM sources without `require()` workarounds. Delaying this wave forces every later mission to carry CJS interop boilerplate, increasing friction and risk of inconsistent module boundaries.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: dependency-wave heuristic (ADR 0036), zero-dep philosophy (ADR 0042), tsconfig.json already configured with `strict: true` and `module: NodeNext`

## Scope

### Files converted (leaf modules — no internal lib/ dependencies)

1. **`lib/core/fmt.js` → `lib/core/fmt.ts`** (249 lines)
   - Imports: `node:util` (built-in only)
   - Exports: `colors`, `status`, `agent`, `bold`, `dim`, `colorize`, `stripAnsi`, `visibleWidth`, `padVisibleEnd`, `kv`, `table`, `list`, `path`, `slug`, `branch`, `sha`, `command`, `log`, `setLogger`
   - Test coverage: `test/fmt.test.js` (9 tests)

2. **`lib/core/git.js` → `lib/core/git.ts`** (121 lines)
   - Imports: `child_process` (built-in only)
   - Exports: `git`, `run`, `getCurrentBranch`, `getWorktreeStatus`, `isDirty`, `getUncommittedCount`, `parseUnmergedFiles`, `detectRebaseState`, `getLastCommit`, `getLastThreeCommits`
   - Test coverage: `test/git.test.js` (12 tests)

3. **`lib/core/gitignore.js` → `lib/core/gitignore.ts`** (112 lines)
   - Imports: `fs`, `path` (built-in only)
   - Exports: `ensureWorkflowGitignore` (default), `WORKFLOW_ENTRIES`
   - Test coverage: none (no dedicated test file)

4. **`lib/core/spawn-tee.js` → `lib/core/spawn-tee.ts`** (200 lines)
   - Imports: `child_process`, `path` (built-in only)
   - Exports: `spawnAndTee`, `DEFAULT_MAX_TALL_BYTES`, `TailBuffer` (class)
   - Test coverage: `test/spawn-tee.test.js` (14 tests)

### Files converted (modules with internal dependencies — after upstream conversion)

5. **`lib/core/state-map.js` → `lib/core/state-map.ts`** (108 lines)
   - Imports: `fs`, `path` (built-in), `./product-config` (internal — must be converted first)
   - Exports: `SHIPPED_STATE_MAP_PATH`, `loadStateMap`, `normalizeState`, `resolveStateMapPath`, `toActual`, `toVirtual`, `transitionVirtual`
   - Test coverage: `test/state-map.test.js` (3 tests)

6. **`lib/core/runtime-matrix.js` → `lib/core/runtime-matrix.ts`** (95 lines)
   - Imports: `fs`, `path` (built-in), `../agents/agents` (internal — must be converted first)
   - Exports: `launcherStatus`, `buildAutonomousReviewMatrix`, `formatMatrixSummary`, `runnableDifferentFamilyExists`
   - Test coverage: `test/runtime-matrix.test.js` (11 tests)

### Upstream prerequisites

- `lib/core/product-config.js` → `lib/core/product-config.ts` (536 lines) — no internal deps, leaf node. Must convert before `state-map.ts`.
- `lib/agents/agents.js` → `lib/agents/agents.ts` (932 lines) — has internal deps of its own. This is out of scope for this mission; `runtime-matrix.ts` will be left as CJS with a note.

### Conversion rules

- Rename `.js` → `.ts` for each converted module
- Replace `const x = require('node:...')` with `import x from 'node:...';` (Node.js builtins use `node:` protocol)
- Replace `const x = require('relative/path')` with `import x from './path.js';` (ESM requires explicit `.js` extension even for `.ts` sources)
- Replace `module.exports = { ... }` with named `export` statements
- Replace `module.exports.foo = bar` / `module.exports.FOO = FOO` with `export const foo = bar; export const FOO = FOO;`
- Preserve all JSDoc `@param`, `@returns`, `@type` annotations
- Add `@type` annotations where JSDoc is sparse
- Export TypeScript interfaces/types for any return shapes consumed by callers
- Delete the original `.js` file only after the `.ts` file compiles and tests pass
- Add `"type": "module"` to `package.json` to enable ESM resolution
- Run `tsc` (not just `tsc --noEmit`) to emit compiled `.js` files, then run `node --test` on compiled output or use `tsx` to run `.ts` tests directly

## Out of Scope

- Converting `lib/agents/agents.js` (932 lines, deep internal dependencies) — blocks `runtime-matrix.ts` conversion
- Converting `lib/core/mission-utils.js`, `lib/core/storage.js`, `lib/core/verification.js`, `lib/core/persistent-data-migration.js` — not in the 6-module set
- Converting any `lib/commands/`, `lib/tools/`, or `test/` files
- Writing new tests — only existing tests are preserved and must pass
- Modifying `index.js` (main entry point) or `px.js` (CLI entry point)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Generic phrases are not sufficient.

- SC 1: All 6 `.js` source files are converted to ES module syntax (`import`/`export` replacing all `require()`/`module.exports`). Verified by grep: zero occurrences of `require(` and `module.exports` in the 6 converted files.
- SC 2: `npm test` passes with identical pass/fail counts to baseline (1694 pass, 0 fail, 22 skipped). No new failures introduced by the conversion.
- SC 3: `npm run typecheck` (`tsc --noEmit`) reports zero errors across the entire project.
- SC 4: All exported symbols from each of the 6 modules are still accessible to importing code. Verified by confirming that every file in `lib/` and `test/` that imports from the 6 converted modules still loads without `ERR_REQUIRE_ESM` or `MODULE_NOT_FOUND` errors.
- SC 5: No behavioral regression in the 6 modules' public APIs. Specifically:
  - `fmt.status()`, `fmt.agent()`, `fmt.log.*` produce identical output (ANSI sequences match)
  - `git.git()`, `git.getCurrentBranch()`, `git.detectRebaseState()` return identical structures
  - `gitignore()` produces identical `.gitignore` content and return objects
  - `spawnAndTee()` returns identical result shape with same stdout/stderr content
  - `state-map.toActual()`, `state-map.toVirtual()` return identical mappings
  - `runtime-matrix.buildAutonomousReviewMatrix()` returns identical matrix structure
- SC 6: `scripts/verify-local.sh docs` passes (README.md, CHANGELOG.md, LICENSE, docs/adr/ all present).
- SC 7: Line counts of converted files differ from originals by at most ±10 lines (accounting for import statement restructuring and type annotation additions).

## Risks and Assumptions

- **Risk**: Adding `"type": "module"` to `package.json` breaks all existing `require()` calls in non-converted files. Mitigation: convert ALL files that `require()` from the 6 modules before flipping `"type": "module"`. This mission only touches the 6 modules; if any `lib/` file `require()`s from them, those files must also be updated to use `import` (even if they stay as `.js`).
- **Assumption**: Node.js `>=20` engine requirement supports ESM `import`/`export` in `.js` files when `"type": "module"` is set. (ESM is supported in Node 12+; Node 20+ is well within support.)
- **Risk**: `state-map.js` imports `./product-config` and `runtime-matrix.js` imports `../agents/agents`. If those upstream files are not also converted, the ESM import chain breaks. Mitigation: convert `product-config.js` as part of this mission (it's a leaf node). Leave `runtime-matrix.js` as CJS if `agents.js` cannot be converted in the same wave.
- **Assumption**: Existing tests do not rely on CJS-specific behavior (e.g., `require.cache` manipulation). All tests use `require()` to load modules under test; after conversion, tests must switch to dynamic `import()` or the test files must also gain `"type": "module"`.
- **Risk**: Dynamic `require()` calls inside the converted modules (e.g., `state-map.js` line 98: `const fmt = require('./fmt')` inside a function) must become static top-level `import` statements or dynamic `import()` calls.

## Checkpoints

- CP 1: Leaf modules converted — `fmt.ts`, `git.ts`, `gitignore.ts`, `spawn-tee.ts` switched to ESM syntax, tests pass for each individually.
- CP 2: Upstream dependency `product-config.ts` converted to ESM; `state-map.ts` converted and its tests pass.
- CP 3: `runtime-matrix.ts` converted (if `agents.js` is also converted, or left as CJS with documented blocker). Full `npm test` suite passes. `tsc --noEmit` clean.

## Gates

- [ ] npm test
- [ ] npm run typecheck
- [ ] scripts/verify-local.sh docs
- [ ] grep -rc 'require(' lib/core/{fmt,git,gitignore,spawn-tee,product-config,state-map,runtime-matrix}.ts | awk -F: '{s+=$2} END {exit (s==0 ? 0 : 1)}'
- [ ] grep -rc 'module.exports' lib/core/{fmt,git,gitignore,spawn-tee,product-config,state-map,runtime-matrix}.ts | awk -F: '{s+=$2} END {exit (s<=1 ? 0 : 1)}'

## Restricted Areas

- Do not modify `lib/agents/agents.js` — it has too many internal dependencies to convert safely in this wave. If `runtime-matrix.js` cannot convert because of it, leave `runtime-matrix.js` as CJS and document the blocker.
- Do not modify `index.js`, `px.js`, or any file outside `lib/core/` except `package.json` (for `"type"` field addition).
- Do not change test file extensions or add new test files.
- Do not modify `tsconfig.json` — its current settings (`allowJs: false`, `strict: true`, `module: NodeNext`) are the target configuration.
- Do not modify `config/agents.json`, `config/state-map.json`, or `workflow.config.json`.

## Stop Rules

- Stop if `npm test` introduces any new failures after conversion of a single module — investigate and fix before proceeding to the next module.
- Stop if `tsc --noEmit` reports more than 5 new errors attributable to the conversion — escalate for manual review.
- Stop if converting `runtime-matrix.js` requires changes to `lib/agents/agents.js` — this indicates scope creep beyond the 6-module set.
- Stop if the `"type": "module"` change in `package.json` causes ERR_REQUIRE_ESM errors in any non-converted file — defer the package.json change to a separate mission.
- Stop if any exported symbol from the 6 modules becomes inaccessible to importing code (import path or name mismatch) — fix before continuing.
