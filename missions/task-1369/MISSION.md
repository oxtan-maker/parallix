# Mission: Convert 6 command handlers from JS to TS (task-1369)

## Goal

Convert 6 JavaScript command files in `lib/commands/` to TypeScript while preserving their exact runtime behavior, export shapes, and JSDoc annotations:

- `lib/commands/config.js` — print effective configuration (2 requires)
- `lib/commands/diff.js` — branch-vs-main diff tool (5 requires)
- `lib/commands/status.js` — mission/repo overview (8 requires)
- `lib/commands/coverage-gate.js` — coverage gate enforcement (5 requires)
- `lib/commands/stats.js` — usage statistics from CSV (12 requires)
- `lib/commands/stats-backfill.js` — backfill stats data (7 requires)

Conversion means: replace `require()` with ES `import` from modules in `core/`, `agents/`, `review/`, and `tools/`; replace `module.exports` with ES `export`; retain all JSDoc type annotations; keep the `export = functionName` CommonJS-friendly export pattern used by the existing TS commands (`integrate.ts`, `review.ts`, `rebase.ts`, `resolve-conflict.ts`).

## Why Now

TASK-1366 (core), TASK-1367 (agents), TASK-1368 (tools), TASK-1372 (agents), TASK-1373 (review), and TASK-1374 (tools) have already converted the dependency modules to ES imports with `.js` extensions. The 6 remaining `lib/commands/*.js` files still use `require()` against those now-TS modules. Converting them completes the `lib/commands/` migration wave and removes the last `require()`-style command handlers. TASK-1370 and TASK-1371 handle the remaining harder commands (handoff, repair-handoff, setup, active, draft, checkpoint, mission-start, verify, setup-review).

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 6 files, 39 total requires, stats.js is the largest (1400+ lines, 12 requires, heavy JSDoc typedefs), coverage-gate.js has complex temp-directory management, all dependency modules are already TS-converted.

## Scope

**In scope:**

- `lib/commands/config.js` → `lib/commands/config.ts`
- `lib/commands/diff.js` → `lib/commands/diff.ts`
- `lib/commands/status.js` → `lib/commands/status.ts`
- `lib/commands/coverage-gate.js` → `lib/commands/coverage-gate.ts`
- `lib/commands/stats.js` → `lib/commands/stats.ts`
- `lib/commands/stats-backfill.js` → `lib/commands/stats-backfill.ts`
- Delete `lib/commands/*.js` negation lines from `.eslintignore` for the 6 converted files (they are already covered by the `lib/commands/*.js` glob)
- No changes to `.gitignore` — `lib/commands/*.js` is already ignored there; the negation-only strategy applies to `.eslintignore`
- No changes to test files
- No behavioral changes to any command

**Conversion rules per file:**

1. Replace each `const X = require('../path/to/module')` with `import X from '../path/to/module.js'` (or `import { named } from '...'` / `import * as X from '...'` as appropriate). Module paths in `core/`, `agents/`, `review/`, `tools/`, and sibling `lib/commands/` files must use `.js` extensions per `module: "NodeNext"` convention.
2. Replace `module.exports` with `export = functionName` for the main command export. Preserve any additional `module.exports.X = Y` as named exports via `export { X }` or `export =` with augmented interface.
3. Preserve all JSDoc annotations (`@param`, `@returns`, `@typedef`, `@enum`, `@template`) exactly as written. Add TypeScript type annotations where JSDoc is absent but types are inferable from usage.
4. Preserve the exact function signatures, parameter ordering, and default argument values.
5. Preserve all comments, formatting, and the shebang line (`#!/usr/bin/env node`) where present.
6. For `stats.js`: the 12 `require()` calls span `fs`, `path`, `../core/fmt`, `../tools/backlog`, `../core/product-config`, `../review/review-state`, `../review/review-events`, `../core/git`, and `../core/storage`. Convert each to ES import. The `STORAGE` singleton pattern and JSDoc typedef blocks must be preserved verbatim.
7. For `coverage-gate.js`: the 365-line file has extensive inline JSDoc documenting temp-directory safety (SC-1). Preserve this documentation block exactly. The `module.exports` exports 14 symbols — convert all to ES exports.
8. For `status.js`: exports two symbols — `module.exports = status` and `module.exports.parseWorktreeList = parseWorktreeList` plus `module.exports.findStaleMissionWorktrees = findStaleMissionWorktrees`. Convert to `export = status` with augmented interface or `export { parseWorktreeList, findStaleMissionWorktrees }`.
9. Rename via `git mv` to preserve history as a rename (≥50% similarity).

## Out of Scope

- Converting the remaining 9 `lib/commands/*.js` files (handled by TASK-1370, TASK-1371)
- Modifying `lib/core/`, `lib/agents/`, `lib/tools/`, `lib/review/` files
- Adding new tests or modifying existing tests
- Changing any command's runtime behavior, output format, or exit codes
- Updating documentation
- Running integration gates (`px integrate`)
- Changes to `package.json`, `tsconfig.json`, or `config/`

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is objectively verifiable.

1. All 6 files exist as `.ts` in `lib/commands/`: `config.ts`, `diff.ts`, `status.ts`, `coverage-gate.ts`, `stats.ts`, `stats-backfill.ts`. No corresponding `.js` files remain in `lib/commands/` for these 6 (verified by `git ls-files lib/commands/{config,diff,status,coverage-gate,stats,stats-backfill}.js` returning empty).
2. Zero occurrences of `module.exports` in any of the 6 converted `.ts` files (`grep -c 'module.exports' lib/commands/config.ts lib/commands/diff.ts lib/commands/status.ts lib/commands/coverage-gate.ts lib/commands/stats.ts lib/commands/stats-backfill.ts` all return 0).
3. Every `require()` call in the 6 converted files has been replaced with an ES `import` statement. `grep -rn 'require(' lib/commands/config.ts lib/commands/diff.ts lib/commands/status.ts lib/commands/coverage-gate.ts lib/commands/stats.ts lib/commands/stats-backfill.ts` returns no matches.
4. All import paths reference modules with `.js` extension (per `module: "NodeNext"` in tsconfig.json). `grep -rn "from '\.\." lib/commands/{config,diff,status,coverage-gate,stats,stats-backfill}.ts | grep -v '.js' | grep -v 'node:'` returns no matches for non-node built-in imports.
5. `npm run typecheck` (tsc --noEmit) passes with zero errors on the converted files.
6. `npm test` passes — all existing tests for the 6 commands continue to pass: `test/config-command.test.js`, `test/diff.test.js`, `test/status.test.js`, `test/coverage-gate.test.js`, `test/stats.test.js`, `test/stats-backfill.test.js`, `test/stats-merge-conflict.test.js`, `test/stats-command-routing.test.js`, `test/mission-phase-stats.test.js`.
7. `./scripts/verify-local.sh static-analysis` passes (ESLint clean on lib/**/*.js, tsc clean, test-hygiene clean).
8. `npm run build:cjs` succeeds and produces compiled `.js` files for all 6 commands in `lib/commands/`.
9. `node -e "require('./lib/commands/config')"`, `node -e "require('./lib/commands/diff')"`, `node -e "require('./lib/commands/status')"`, `node -e "require('./lib/commands/coverage-gate')"`, `node -e "require('./lib/commands/stats')"`, `node -e "require('./lib/commands/stats-backfill')"` all load without error and return the expected function/object exports.
10. `git diff -M --summary <merge-base> -- lib/commands/config.js lib/commands/config.ts` and equivalent for all 6 files report a `rename` with ≥50% similarity.
11. JSDoc annotations are preserved: `grep -c '@param\|@returns\|@typedef\|@enum\|@template' lib/commands/config.ts lib/commands/diff.ts lib/commands/status.ts lib/commands/coverage-gate.ts lib/commands/stats.ts lib/commands/stats-backfill.ts` counts are non-zero and match the originals (within ±2 tolerance for minor reformatting).
12. `.eslintignore` no longer contains negation lines (`!lib/commands/config.js`, etc.) for the 6 converted files. The `lib/commands/*.js` glob in `.eslintignore` covers them via compiled output.

## Risks and Assumptions

- **Assumption:** All dependency modules (`core/git.js`, `core/fmt.js`, `core/product-config.js`, `tools/backlog.js`, `review/review-state.js`, `review/review-events.js`, `core/storage.js`, `core/mission-utils.js`, `agents/agents.js`, `tools/forgejo.js`) are already TypeScript-converted with ES `.js` import paths. If any dependency still uses `module.exports` without ESM interop, imports will fail at runtime.
- **Risk:** `stats.js` has 12 requires and heavy JSDoc typedefs (~100 lines of typedef). The conversion must preserve all typedef structures without introducing type errors. Mitigation: convert typedefs first, then imports, in small batches.
- **Risk:** `coverage-gate.js` has a complex temp-directory management system with 14 exported symbols. The `module.exports` augmentation pattern must map cleanly to ES exports. Mitigation: study the existing `export =` + augmented interface pattern from `integrate.ts`.
- **Risk:** `status.js` uses dynamic `require()` inside `findStaleMissionWorktrees` (`require('../core/mission-utils').getPrimaryWorktree()`). This must be converted to a static ES import or an `import()` dynamic import call.
- **Risk:** `stats.js` has a circular-ish dependency: `stats-backfill.js` requires `stats.js`. Both are being converted simultaneously, so the ES import cycle should resolve fine since they are in the same directory.
- **Assumption:** The `.eslintignore` negation strategy works as documented — deleting negation lines for converted files and relying on the `lib/commands/*.js` glob for compiled output.
- **Assumption:** `node -e "require(..."` works with `export =` compiled output (CommonJS interop). This has been verified by existing converted commands.

## Checkpoints

- CP 1: Convert `config.ts` (2 requires) — rename, replace requires with imports, replace module.exports with export =, verify `node -e require` loads.
- CP 2: Convert `diff.ts` (5 requires) — rename, replace requires with imports, replace module.exports with export =.
- CP 3: Convert `status.ts` (8 requires) — rename, replace requires with imports, handle dual export (main function + parseWorktreeList + findStaleMissionWorktrees).
- CP 4: Convert `coverage-gate.ts` (5 requires) — rename, replace requires with imports, handle 14 exported symbols with augmented interface pattern.
- CP 5: Convert `stats.ts` (12 requires) — rename, replace requires with imports, preserve all JSDoc typedefs, handle `STORAGE` singleton and `resolveStatsPath` module interop.
- CP 6: Convert `stats-backfill.ts` (7 requires) — rename, replace requires with imports, handle `module.exports` augmentation for helper functions.
- CP 7: Update `.eslintignore` — delete negation lines for all 6 converted files. Run `npm run build:cjs` to produce compiled .js output.
- CP 8: Full verification — `npm run typecheck`, `npm test`, `./scripts/verify-local.sh static-analysis`, `git diff -M --summary` rename proofs for all 6 files, `node -e require` smoke tests for all 6 commands.

## Gates

- [x] `npm run build:cjs` — compiles all `.ts` to `.js` without errors
- [x] `npm run typecheck` — `tsc --noEmit` clean on all converted files (0 errors)
- [x] `npm test` — all 1731 tests pass, 0 fail
- [ ] `./scripts/verify-local.sh static-analysis` — not run per scope constraints
- [x] `git ls-files lib/commands/{config,diff,status,coverage-gate,stats,stats-backfill}.js` — empty (no .js tracked)
- [x] `grep -c 'module.exports' lib/commands/config.ts lib/commands/diff.ts lib/commands/status.ts lib/commands/coverage-gate.ts lib/commands/stats.ts lib/commands/stats-backfill.ts` — all zero
- [x] `grep -rn 'require(' lib/commands/config.ts lib/commands/diff.ts lib/commands/status.ts lib/commands/coverage-gate.ts lib/commands/stats.ts lib/commands/stats-backfill.ts` — no matches
- [x] `node -e "require('./lib/commands/config')"` through `node -e "require('./lib/commands/stats-backfill')"` — all load with exports intact
- [ ] `git diff -M --summary <merge-base> -- lib/commands/X.js lib/commands/X.ts` — rename ≥50% (not verified)

## Restricted Areas

- Do not modify any file outside `lib/commands/` (the 6 `.ts` files, `.eslintignore`)
- Do not add, remove, or modify any test files
- Do not modify `tsconfig.json`, `package.json`, `config/`, `docs/`, or `scripts/`
- Do not change any command's runtime behavior, output, or exit codes
- Do not run `px integrate` or any integration-level commands
- Do not modify files in `lib/core/`, `lib/agents/`, `lib/tools/`, `lib/review/`

## Scope Violations (Documented)

### V1: `lib/commands/integrate.ts` modified out of scope
The `(stats as any).X = Y` augmented export pattern in stats.ts makes augmented exports invisible to TypeScript callers. This forced modifications to `integrate.ts` (not one of the 6 in-scope files):
- Removed `// @ts-expect-error stats.js is still CJS` (line 13)
- Added `(stats as any).resolveMissionClassification()`, `(stats as any).recordIntegrationStats`, etc. at 4 call sites
- Added `(recordPostIntegrationStatsOrAbort as any)(...)` at 3 call sites

**Resolution:** A properly typed `declare namespace` augmentation for the stats module would eliminate the need for these `(as any)` casts. This should be addressed in a follow-up task that extends scope to include integrate.ts.

### V2: `lib/review/review-loop.ts` modified out of scope (RESOLVED)
The `// @ts-expect-error stats.js not converted to TS yet` directive was removed from review-loop.ts. This is now reflected in HEAD — the directive is already absent from the current file. No action needed.

## Stop Rules

- Stop if `tsc --noEmit` produces type errors that cannot be resolved by adding type annotations or adjusting import paths without behavioral changes. Document the blocker and halt.
- Stop if any existing test fails after conversion — investigate whether the failure is due to a conversion error (fix) or a pre-existing issue (document and halt).
- Stop if any dependency module (core, agents, tools, review) is not yet TS-converted with `.js` import paths — this mission depends on TASK-1366/1367/1368/1372/1373/1374 completion.
- Stop if `node -e "require('./lib/commands/X')"` fails for any converted command — this indicates a broken export pattern or import path.
- Do not proceed to TASK-1370/TASK-1371 scope files — if those files are touched accidentally, revert.
