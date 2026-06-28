# Mission: Convert 2 core persistence modules from CJS to ESM/TypeScript (task-1367)

## Goal

Convert the 2 remaining CommonJS modules in `lib/core/` — `storage.js` (179 lines) and `persistent-data-migration.js` (241 lines) — to ES Module syntax (`import`/`export`) with TypeScript type annotations. Files are renamed `.js` → `.ts`. `product-config.ts` was already converted by TASK-1366 and is not touched. All conversions preserve runtime behavior, public APIs, and test pass rates.

## Why Now

This is Wave 2 of the repository-wide CJS→ESM migration. TASK-1366 converted 6 core foundation modules including `product-config.ts`. These 2 remaining `lib/core/` modules are the last CJS files in the core directory that other parts of `lib/` depend on. Converting them eliminates the final CJS barrier in `lib/core/`, allowing every module in `lib/` to import from `.ts` ESM sources without `require()` workarounds. The modules `lib/index.js`, `lib/commands/stats.js`, and `lib/agents/agents.js` all `require()` from these files, so converting them is a prerequisite for any downstream mission that wants a fully ESM `lib/` tree.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: dependency-wave heuristic (ADR 0036), zero-dep philosophy (ADR 0042), tsconfig.json already configured with `strict: true` and `module: NodeNext`, `product-config.ts` already converted proving the pattern works

## Scope

### Files converted

1. **`lib/core/storage.js` → `lib/core/storage.ts`** (179 lines)
   - Imports: `node:fs`, `node:os`, `node:path` (all built-in)
   - Exports: `resolveParallixHome`, `resolveStatsPath`, `resolveAgentsLocalPath`, `readJson`, `writeJson`, `writeFileAtomic`, `isInitialized`
   - No internal `lib/` dependencies — pure leaf module
   - Test coverage: `test/storage.test.js` (23 tests)

2. **`lib/core/persistent-data-migration.js` → `lib/core/persistent-data-migration.ts`** (241 lines)
   - Imports: `node:fs`, `node:path` (built-in), `./storage` (internal — must be converted first), `../commands/stats` (internal, lazy `require()` inside function)
   - Exports: `migrateStats`, `migrateAgentBlocklists`, `_internals: { parseCsvLine, readStatsRows, serializeStatsRows }`
   - Test coverage: `test/persistent-data-migration.test.js` (7 tests)

### Upstream consumers that must continue to work

- `lib/index.js` line 54: `module.exports.persistentDataMigration = require('./core/persistent-data-migration')`
- `lib/index.js` line 59: `module.exports.storage = require('./core/storage')`
- `lib/commands/stats.js` line 207: `STORAGE = require('../core/storage')` (lazy require)
- `lib/commands/stats.js` line 240: `require('../core/persistent-data-migration').migrateStats(...)`
- `lib/agents/agents.js` line 11: `const storage = require('../core/storage')`
- `lib/agents/agents.js` line 13: `const { migrateAgentBlocklists } = require('../core/persistent-data-migration')`

These consumers use CJS `require()` to import from `lib/core/`. After conversion, the pretest compilation step (`tsc --rootDir . --outDir . --module CommonJS`) generates `.js` files alongside the `.ts` sources, so the `require()` calls resolve to the compiled output and continue to work.

### Conversion rules

- Rename `.js` → `.ts` for each converted module via **`git mv` (or an equivalent faithful conversion)** so git records a rename, not a delete+add. The `.ts` must stay close enough to the original `.js` that `git diff -M` reports a rename **≥ 50% similarity** (git's default threshold). Concretely: preserve the original import names (e.g. keep `storage`, do not rename to `pxStorage`), helper functions (e.g. `getStatsHeaders`), formatting, blank lines, and comments — change only what ESM/TS requires. The reviewer must see "`X.js` moved to `X.ts`, then changed for ts fixes," not a rewrite.
- Replace `const x = require('node:...')` with `import x from 'node:...';` (Node.js builtins use `node:` protocol)
- Replace `const x = require('relative/path')` with `import x from './path.js';` (ESM requires explicit `.js` extension even for `.ts` sources)
- Replace `module.exports = { ... }` with named `export` statements; preserve the exact public export shape, including `_internals`
- Preserve all JSDoc `@param`, `@returns`, `@type` annotations (do not bloat them into verbose multi-line blocks — that hurts rename similarity)
- Add `@type`/inline type annotations where JSDoc is sparse
- Define TypeScript interfaces for public return shapes (e.g., `ResolveParallixHomeResult`, `ReadJsonResult`)
- A single lazy `require('../commands/stats.js')` inside `persistent-data-migration.ts` is **permitted** to break the `stats` ↔ `persistent-data-migration` circular dependency (compiled under `module: CommonJS`). This is the one allowed `require()`.
- **Remove the old compiled/source `.js` from git** with `git rm --cached lib/core/<name>.js` (and delete on disk). The `.gitignore` `lib/core/*.js` glob keeps the regenerated artifact untracked. **No autogenerated `.js` may be committed.**
- Compiled `.js` are produced deterministically by `npm run build:cjs` (used by both `pretest` and `prepublishOnly`), gitignored, and shipped only inside the npm package (`files: ["lib/"]`). parallix runs as plain Node CJS and `require()`s `lib/core/*.js` at runtime, so they must exist in the published package — just never in git.
- `package.json` MAY be edited **only** to wire the deterministic build (`build:cjs`, and `pretest`/`prepublishOnly` pointing at it). Do NOT add `"type": "module"`.
- Add/maintain `.eslintignore` so the static-analysis gate does not lint compiled output (`lib/core/*.js`).

## Out of Scope

- Converting any other `lib/` files (`mission-utils.js`, `nels.js`, `subagent-limit.js`, `verification.js`)
- Converting `lib/index.js`, `lib/commands/stats.js`, `lib/agents/agents.js` — they remain CJS and import from the compiled `.js` output
- Converting any files in `lib/tools/`, `lib/review/`, `lib/commands/` (non-core)
- Writing new tests — only existing tests are preserved and must pass
- Modifying `tsconfig.json` — its current settings are the target configuration
- Modifying `workflow.config.json`, `config/` files, or any configuration

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Generic phrases are not sufficient.

- **SC1:** Both `.js` source files are removed and replaced with `.ts` files using ES module syntax (`import`/`export` replacing `module.exports` and all `require()` **except** the one permitted lazy `require('../commands/stats.js')` circular-dependency break). Verified by grep: zero `module.exports`, and zero `require(` in `storage.ts`; at most that single lazy `require(` in `persistent-data-migration.ts`.
- **SC2:** `npm test` passes with identical pass/fail counts to baseline (1729 pass, 0 fail, 22 skipped). No new failures introduced by the conversion.
- **SC3:** `npm run typecheck` (`tsc --noEmit`) reports zero errors across the entire project.
- **SC4:** All exported symbols from each of the 2 modules are still accessible to importing code. Verified by confirming that every file in `lib/` that imports from the 2 converted modules still loads without `ERR_REQUIRE_ESM` or `MODULE_NOT_FOUND` errors after pretest compilation.
- **SC5:** No behavioral regression in the 2 modules' public APIs. Specifically:
  - `storage.resolveParallixHome()` returns identical paths for all platform/env inputs (linux, darwin, win32, fallback)
  - `storage.readJson()` returns `{ ok: true/false, error, data }` with identical semantics
  - `storage.writeJson()` writes identical JSON content and creates parent directories
  - `storage.writeFileAtomic()` performs atomic write via temp+rename
  - `storage.isInitialized()` returns identical boolean for same directory state
  - `persistentDataMigration.migrateStats()` merges and deduplicates rows identically, produces identical CSV output
  - `persistentDataMigration.migrateAgentBlocklists()` merges blocklists with identical conflict resolution and warning output
- **SC6:** `npm run build` (`tsc`) compiles all `.ts` files in `lib/` without errors.
- **SC7:** Line counts of converted files differ from originals by at most ±15 lines (accounting for import statement restructuring and type annotation additions).
- **SC8 (no autogenerated `.js` in git):** `git ls-files lib/core/*.js` does **not** list `storage.js` or `persistent-data-migration.js` (only still-hand-written modules remain tracked). No TypeScript-compiled `.js` is committed anywhere.
- **SC9 (clean rename history):** `git diff -M --summary main -- lib/core/storage.js lib/core/storage.ts` reports a `rename` (≥ 50%), and likewise for `persistent-data-migration`. History reads as move + ts fixes, not delete+add.
- **SC10 (deterministic distribution):** From a tree with no compiled `.js`, `npm run prepublishOnly` regenerates `lib/core/storage.js` and `lib/core/persistent-data-migration.js`, and `npm pack --dry-run` lists both compiled `.js` (they are required at runtime). `node -e "require('./lib/core/storage'); require('./lib/core/persistent-data-migration')"` loads without error and exposes the same exports (including `_internals`).
- **SC11 (gate robustness):** `./scripts/verify-local.sh static-analysis` passes **even when compiled `lib/core/*.js` are present on disk** (i.e. after `npm test`), because `.eslintignore` excludes compiled output.

## Risks and Assumptions

- **Risk:** The dynamic/lazy `require('./fmt')` inside `persistent-data-migration.js` (line 8: `if (!_stats) { _stats = require('../commands/stats'); }`) must become a static top-level `import` or a dynamic `import()`. Since `getStats()` is called inside `readStatsRows()` and `serializeStatsRows()`, a static import is safe (no circular dependency cycle — `stats.js` imports `persistent-data-migration` for `migrateStats()` but `persistent-data-migration` only calls `getStats()` lazily).
- **Risk:** The `_internals` export (used by tests) must be preserved as a named export: `export { parseCsvLine, readStatsRows, serializeStatsRows }` or `export const _internals = { ... }`.
- **Assumption:** The pretest compilation step (`tsc --rootDir . --outDir . --module CommonJS`) generates `.js` files in the same directory as the `.ts` sources, so existing `require()` calls in `lib/index.js`, `lib/commands/stats.js`, and `lib/agents/agents.js` resolve correctly.
- **Assumption:** Node.js `>=20` engine requirement supports the ESM `import`/`export` syntax in `.ts` files compiled by `tsc`.
- **Risk:** `readStatsRows()` calls `getStats().normalizeStatsRow()` and `getStats().STATS_HEADERS`. The lazy `require('../commands/stats')` must be converted to an ESM import. Since `stats.js` imports `persistent-data-migration` (for `migrateStats`), there is a potential circular dependency. Mitigation: use dynamic `import()` for the lazy path, or verify the cycle is breakable with static import (Node.js handles circular ESM exports safely).
- **Assumption:** Existing tests do not rely on CJS-specific behavior. The test files use `require()` to import from converted modules, which resolve to the pretest-compiled `.js` files.

## Checkpoints

- **CP 1:** `lib/core/storage.ts` converted — all `require()` replaced with `import`, `module.exports` replaced with named `export`, TypeScript interfaces added for return types. Original `.js` deleted. `npm run pretest && npm test` passes for `test/storage.test.js` (23 tests).
- **CP 2:** `lib/core/persistent-data-migration.ts` converted — all `require()` replaced with `import` (handling circular dependency with `../commands/stats` via dynamic `import()`), `module.exports` replaced with named `export`, TypeScript interfaces added. Original `.js` deleted. `npm run pretest && npm test` passes for `test/persistent-data-migration.test.js` (7 tests).
- **CP 3:** Full `npm test` suite passes (1729 pass, 0 fail, 22 skipped). `tsc --noEmit` clean. `tsc` (full build) clean.

## Gates

- [ ] `npm test` — 1729 pass, 0 fail, 22 skipped (same as baseline)
- [ ] `npm run typecheck` — `tsc --noEmit` reports zero errors
- [ ] `npm run build` — `tsc` compiles all `lib/**/*.ts` without errors
- [ ] `grep -c 'module.exports' lib/core/storage.ts lib/core/persistent-data-migration.ts` — zero
- [ ] `grep -c 'require(' lib/core/storage.ts` — zero; `grep -c 'require(' lib/core/persistent-data-migration.ts` — at most 1 (the permitted lazy stats require)
- [ ] `git ls-files lib/core/storage.js lib/core/persistent-data-migration.js` — empty (no compiled `.js` tracked) [SC8]
- [ ] `git diff -M --summary main -- lib/core/storage.js lib/core/storage.ts | grep -q rename` and same for `persistent-data-migration` [SC9]
- [ ] `npm run prepublishOnly && npm pack --dry-run | grep -E 'lib/core/(storage|persistent-data-migration)\.js'` — both compiled `.js` present in the package [SC10]
- [ ] `./scripts/verify-local.sh static-analysis` passes with compiled `lib/core/*.js` present on disk [SC11]

## Restricted Areas

- Do not modify `lib/index.js`, `lib/commands/stats.js`, or `lib/agents/agents.js` — they use CJS `require()` to import from the compiled `.js` output. Their imports must continue to work without changes.
- Do not modify `tsconfig.json` — its current settings (`allowJs: false`, `strict: true`, `module: NodeNext`) are the target configuration.
- `package.json` may be edited **only** to wire the deterministic CJS build (`build:cjs`, with `pretest` and `prepublishOnly` delegating to it). Do not add `"type": "module"` or change any other field.
- Do not modify `config/agents.json`, `config/state-map.json`, or `workflow.config.json`.
- Do not add new test files or modify existing test files.
- Allowed file changes: `lib/core/storage.ts`, `lib/core/persistent-data-migration.ts` (faithful renames of the originals), removal of the compiled `lib/core/storage.js` / `persistent-data-migration.js` from git, `package.json` (build wiring only), and `.eslintignore` (ignore compiled output).

## Stop Rules

- Stop if `npm test` introduces any new failures after conversion of `storage.ts` — investigate and fix before proceeding to `persistent-data-migration.ts`.
- Stop if `tsc --noEmit` reports more than 5 new errors attributable to the conversion — escalate for manual review.
- Stop if the circular dependency between `persistent-data-migration.ts` and `commands/stats.ts` cannot be resolved without modifying `commands/stats.js` — this indicates scope creep.
- Stop if converting `persistent-data-migration.ts` requires changes to any file outside `lib/core/` — the mission scope is limited to the 2 core modules.
- Stop if any exported symbol from the 2 modules becomes inaccessible to importing code after the pretest compilation step — fix before continuing.
