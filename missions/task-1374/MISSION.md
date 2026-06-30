# Mission: Entry points (index.js, px.js) + enable and fix all TypeScript errors (task-1374)

## Goal

Convert the 2 remaining root-level JavaScript entry points (`index.js` → `index.ts`, `px.js` → `px.ts`) to TypeScript with ES module exports, migrate `.eslintrc.cjs` to flat config `eslint.config.mjs`, extend `tsconfig.json` to compile root entry points, update `.gitignore` for compiled root artifacts, update `scripts/verify-local.sh` for flat-config ESLint, and fix all TypeScript errors surfaced by `tsc --noEmit` so the entire codebase is `.ts` source with zero type errors.

## Why Now

This is Mission 11 of the Parallix TypeScript migration (TASK-1364). The `lib/` directory is ~81% converted (52 `.ts` files, 12 `.js` remaining). The 2 root entry points (`index.js` at 257 lines, `px.js` at 234 lines) are the highest-impact remaining JavaScript files — they drive the CLI and package exports. Converting them closes the migration gap and enables the static-analysis gate to lint the whole source tree uniformly. Without this mission, `npm run build:cjs` cannot regenerate `index.js`/`px.js` from TypeScript, so the published package would lack these files or ship stale hand-written JavaScript.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: final entry-point conversions, ESLint flat-config migration, tsconfig/build pipeline updates, accumulated type errors from partial migration.

## Scope

- **Root `index.js` → `index.ts`**: Convert CommonJS `require`/`module.exports` to ES `import`/`export`. Add types for `fmt` (from `lib/core/fmt`), `ensureStandaloneGitRepo` (from `lib/core/product-config`), `loadStateMap` (from `lib/core/state-map`). Preserve all exported members: `KNOWN_COMMANDS`, `main`, `printUsage`, `printAliases`, `suggestCommand`, `buildSuggestionSuffix`, `levenshteinDistance`, `deriveAliases`, `resolveAlias`. Preserve the shebang line.
- **Root `px.js` → `px.ts`**: Convert CommonJS to ES modules. Add types for `fmt`, `missionStart`, `createEvent` (from `lib/review/review-events`), and the `index.ts` module. Preserve all exported members: `formatVersionInfo`, `parseArgs`, `parseReviewEventArgs`, `run`, `shellInit`, `versionInfo`. Preserve the shebang line.
- **`lib/index.js` → `lib/index.ts`**: Convert the 77-line barrel re-export to TypeScript with ES exports, re-exporting all grouped modules (`agents`, `commands`, `core`, `review`, `tools`).
- **ESLint flat-config migration**: Replace `.eslintrc.cjs` with `eslint.config.mjs`. Port all rules (`no-undef`, `no-unused-vars`, `valid-typeof`, `no-unreachable`, `no-async-promise-executor`, `eqeqeq`, `curly`, `no-var`). Port all `.eslintignore` entries into flat-config `ignores`. Use `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin`.
- **`tsconfig.json` update**: Extend `include` from `["lib/**/*.ts"]` to also include root `index.ts` and `px.ts`.
- **`package.json`**: No changes to `main`/`bin` fields — they keep pointing at compiled `.js` output.
- **`scripts/verify-local.sh`**: Update the ESLint stage to lint `.ts` sources instead of `.js` with `--ext` (which is ignored under flat config). The `tsc` and test-hygiene stages remain unchanged.
- **`.gitignore`**: Add root-anchored `/index.js` and `/px.js` to ignore compiled root entry artifacts. Keep them in `package.json` `files`.
- **Build pipeline**: Ensure `npm run build:cjs` compiles root `index.ts` and `px.ts` to produce `index.js` and `px.js` in the project root. Verify via `npm pack --dry-run | grep -E '^npm notice .*(index|px)\.js'`.
- **TypeScript error fixing**: Run `tsc --noEmit` after all conversions and fix all errors — missing JSDoc `@type` annotations, type mismatches, import path resolution, module resolution with `module: NodeNext`, type inference failures, and interface/type mismatches between modules.

## Out of Scope

- Converting the 12 remaining `lib/` JavaScript files (`lib/commands/mission-start.js`, `lib/commands/repair-handoff.js`, `lib/commands/setup.js`, `lib/commands/setup-review.js`, `lib/commands/verify.js`, `lib/core/nels.js`, `lib/core/subagent-limit.js`) — those belong to prior missions.
- Changing `package.json` `main` or `bin` field values.
- Modifying test files.
- Adding new features or behavior changes.
- Migrating other configuration files (e.g., `workflow.config.json`).

## Success Criteria

> Falsifiability rule (ADR 0039 Part 2): Each criterion must be falsifiable.

1. `tsc --noEmit` reports zero errors on the complete source tree (root `.ts` + all `lib/**/*.ts`).
2. `npm run build:cjs` produces `index.js` and `px.js` in the project root (not in `dist/`).
3. `npm pack --dry-run` lists both `index.js` and `px.js` in the packed file manifest.
4. `node px.js --version` runs without error and prints the package version string.
5. `node -e "const m = require('./index.js'); console.log(Object.keys(m).length)"` prints a count ≥ 8 (all exported members present).
6. `npx eslint` (flat config, no `--ext`) reports zero errors on all `.ts` source files.
7. `./scripts/verify-local.sh static-analysis` passes all 3 stages (ESLint, tsc, test-hygiene).
8. `npm test` passes all existing tests at baseline counts (1731 pass, 0 fail).
9. `git ls-files index.js px.js` returns empty (no JavaScript entry points tracked in git source).
10. No `.eslintignore` file remains on disk (fully migrated to flat config).
11. `.eslintrc.cjs` file is removed from the repository.

## Risks and Assumptions

- **Assumption**: `lib/core/fmt`, `lib/core/product-config`, `lib/core/state-map`, `lib/commands/mission-start`, and `lib/review/review-events` already have TypeScript definitions (`.ts` files) that `index.ts` and `px.ts` can import.
- **Risk**: `px.ts` imports `./index` (the root `index.js`), which creates a circular dependency if `index.ts` becomes an ES module that `px.ts` also imports. Must verify import direction and adjust if needed.
- **Risk**: `module: NodeNext` requires `.js` extensions on all relative imports in `.ts` files. Some existing `lib/` `.ts` files may not have these extensions yet, causing new errors when `index.ts`/`px.ts` are added to the compilation scope.
- **Risk**: ESLint flat config may surface rules that were previously suppressed or not enforced by `.eslintrc.cjs`. May need rule adjustments.
- **Assumption**: The existing test suite does not import `index.js` or `px.js` in ways that break after conversion (tests import the compiled `.js` output which `build:cjs` produces).
- **Risk**: The `build:cjs` command uses a custom `tsc` invocation with `--rootDir . --outDir .`. Root-level `.ts` files may need explicit `tsconfig` configuration to compile correctly to the root directory.

## Checkpoints

- CP 1: Convert `lib/index.js` → `lib/index.ts` (barrel re-export) and verify it compiles independently.
- CP 2: Convert `index.js` → `index.ts` (root entry point) and fix all immediate TypeScript errors.
- CP 3: Convert `px.js` → `px.ts` (root CLI entry point) and fix all immediate TypeScript errors.
- CP 4: Update `tsconfig.json` to include root `.ts` files and verify `npm run build:cjs` produces root `.js` artifacts.
- CP 5: Migrate ESLint from `.eslintrc.cjs` + `.eslintignore` to `eslint.config.mjs` with all rules and ignores ported.
- CP 6: Update `.gitignore` to add `/index.js` and `/px.js`.
- CP 7: Update `scripts/verify-local.sh` static-analysis stage for flat-config ESLint.
- CP 8: Run `tsc --noEmit` on the full tree, fix all remaining type errors, and verify zero errors.
- CP 9: Full integration — `npm test`, `npm run build:cjs`, `npm run prepublishOnly`, `./scripts/verify-local.sh static-analysis`, and `npm pack --dry-run` all pass.

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] npm test (all tests pass at baseline counts, no regressions)

## Restricted Areas

- Do not modify any files under `test/`.
- Do not modify `package.json` `main` or `bin` field values.
- Do not convert any `lib/` JavaScript files other than `lib/index.js`.
- Do not change the exported API surface of `index.ts` or `px.ts` (all existing exports must be preserved).
- Do not modify `workflow.config.json` or any `.forgejo-local/` files.

## Stop Rules

- If `tsc --noEmit` surfaces errors that cannot be resolved within the scope of type annotation fixes (e.g., fundamental architectural incompatibilities requiring changes to `lib/` modules outside this mission), stop and report blockers.
- If `npm test` regression count exceeds 0 new failures (excluding the 22 skipped tests which must remain skipped), stop and investigate.
- If ESLint flat config migration breaks the static-analysis gate irrecoverably, revert to `.eslintrc.cjs` and report the blocker.
