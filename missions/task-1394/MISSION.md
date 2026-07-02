# Mission: Remove build:cjs as a prerequisite for core runtime validation (task-1394)

## Goal

Decouple the core test pipeline and CLI runtime from the `build:cjs` pre-step so that tests exercise the TypeScript source tree directly. The `pretest` hook in `package.json` is removed, the test command is changed to run via `tsx` (a TypeScript-aware Node.js runner), and the CLI entry point (`index.ts`) and its dynamic command-loading path are updated to resolve `lib/commands/<name>` against `.ts` sources. The `build:cjs` script remains available for `prepublishOnly` and packaging; it is simply no longer a prerequisite for development-time validation.

## Why Now

After the JS-to-TS conversion wave the source tree is fully TypeScript, yet `npm test` still demands a CommonJS compilation step before any validation. This coupling hides whether the source tree itself is directly runnable, keeps the test loop dependent on generated artifacts, and makes it impossible to tell if a test failure stems from source-code issues or from build-side problems. Removing the prerequisite closes a migration gap and gives developers immediate feedback against the source tree.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: migration gap closure (post-TS conversion pipeline is stale), developer productivity (faster test cycle without CJS emit), test fidelity (source-runtime validation uncovers issues a compiled build can mask)

## Scope

- Add `tsx` as a `devDependency` in `package.json`
- Remove the `"pretest": "npm run build:cjs"` line from `package.json`
- Change the `"test"` script from `FORCE_COLOR=0 node --test test/*.test.js` to `FORCE_COLOR=0 npx tsx --test test/**/*.test.ts` (renaming test files to `.ts`)
- Convert all `test/*.test.js` files to `test/*.test.ts`, preserving their existing `require()` import paths (Node.js module resolution will find the corresponding `.ts` sources under `lib/` when running via `tsx`)
- Update `index.ts` so that the dynamic command lookup path (currently hard-coded to `lib/commands/${command}.js` at line 123) resolves against `.ts` sources when a `.js` artifact is absent — either by falling back to `lib/commands/${command}.ts` or by delegating to a `tsx`-aware resolver
- Update `px.ts` dynamic requires (`_require('./lib/commands/mission-start.js')` at line 218, `_require('./lib/review/review-events.js')` at line 220, `_require('./index.js')` at line 221) to resolve against `.ts` sources when `.js` is unavailable
- Update `scripts/verify-local.sh` `gate_integrate` embedded Node.js heredoc (line 72: `require('./lib/commands/integrate.js')`) to work when only `.ts` sources are present — either by using a `tsx`-based invocation or by falling back to `.ts` resolution
- Leave `build:cjs` intact in `package.json` for `prepublishOnly` and packaging use cases
- Leave the default `npm run build` (`tsc` → `dist/`) unchanged

## Out of Scope

- Removing or rewriting the `build:cjs` script itself (it remains for npm publish)
- Changing the default `npm run build` (`tsc` → `dist/` ESM output)
- Modifying test assertions or test logic — existing test behavior must be preserved
- Updating CI/CD pipeline definitions (GitHub Actions, Forgejo pipelines)
- Adding new features or commands to the CLI
- Changing the `lib/` command implementations
- Modifying `config/integration-pipelines.json` gate definitions
- Converting non-test `.js` files (there are none in the committed tree; all generated `.js` files are ephemeral build artifacts)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Generic claims without attached metrics or file references are insufficient.

1. **`pretest` removed:** `package.json` (line 53) no longer contains a `"pretest"` field. Running `npm test` directly (without `pretest`) passes. Verified by: `grep -n '"pretest"' package.json` returning empty.

2. **Tests run against TypeScript source:** All 100+ test files under `test/` are `.ts` files and run successfully via `tsx --test` without any prior `build:cjs` step. Verified by: `ls test/*.test.ts | wc -l` matches the pre-change `.js` test count, and `npx tsx --test test/**/*.test.ts` exits with code 0.

3. **CLI discovers commands from `.ts` sources:** `node --experimental-strip-types index.ts <command>` (or `npx tsx index.ts <command>`) resolves and executes a `lib/commands/<command>` module when no `.js` sibling exists. Verified by: deleting all `.js` files under `lib/`, then running `npx tsx index.ts status` and confirming it executes without "Unknown command" or module-not-found errors.

4. **`build:cjs` preserved for publishing:** `package.json` still contains `"build:cjs"` at line 51 and `"prepublishOnly": "npm run build:cjs"` at line 52. Verified by: `grep -n '"build:cjs"' package.json` and `grep -n '"prepublishOnly"' package.json` both returning non-empty.

5. **Static analysis gate passes:** `./scripts/verify-local.sh static-analysis` reports clean on all changed files (ESLint, `tsc --noEmit`, test-hygiene). Verified by: exit code 0 from the command.

6. **Source-runtime vs packaged-artifact separation:** The test pipeline exercises `lib/` TypeScript sources directly; any test that specifically requires packaged `.js` artifacts (e.g., `install.test.js` which tests the published package) is annotated with a `packaged-artifact-dep` label and runs via the separate `npm run build` → `node ...` path. Verified by: scanning test file headers for `packaged-artifact-dep` annotations on tests that import `../lib/` expecting `.js` siblings.

## Risks and Assumptions

- **Risk:** `tsx`'s `--test` flag (Node test runner integration) may have edge-case incompatibilities with tests that use deep `require()` cycles or mock patterns. Mitigation: test the full suite under `tsx` early; fall back to `tsx` as a loader (`tsx/cjs`) if `--test` mode is unstable.
- **Risk:** `index.ts` line 123 hard-codes `${command}.js` in the dynamic lookup string. Changing this to also try `.ts` may alter the fallback order and affect edge cases where both `.js` and `.ts` exist. Mitigation: preserve `.js` as the primary lookup, `.ts` as fallback.
- **Assumption:** `tsx` supports `node --test` semantics (test file discovery, TAP output, parallelism) adequately for the existing 100+ test files.
- **Assumption:** `createRequire` in `px.ts` (line 23) resolves `.ts` files correctly when `tsx` is available in the runtime context.
- **Assumption:** `scripts/verify-local.sh` `gate_integrate` embedded Node.js code can be adapted to work with `tsx` (e.g., via `npx tsx -e '...'` or by requiring a `.ts` wrapper).
- **Assumption:** `eslint.config.mjs` already covers `.ts` test files (it does — it lints `lib/`, `index.ts`, `px.ts` and the TS parser handles `.ts` by default).

## Checkpoints

- CP 1: Add `tsx` to `devDependencies` in `package.json` and confirm `npx tsx --version` works.
- CP 2: Remove `"pretest"` from `package.json` and rename the `"test"` script to use `tsx`. Verify a single representative test file runs via `npx tsx --test test/draft.test.ts`.
- CP 3: Rename all `test/*.test.js` files to `test/*.test.ts`. Run the full suite via `npx tsx --test test/**/*.test.ts` and confirm 100% pass rate.
- CP 4: Update `index.ts` line 123 dynamic command lookup to fall back to `.ts` when `.js` is absent. Verify `npx tsx index.ts status` works with no `.js` files under `lib/`.
- CP 5: Update `px.ts` lines 218, 220, 221 dynamic requires to resolve `.ts` when `.js` is absent.
- CP 6: Update `scripts/verify-local.sh` `gate_integrate` embedded Node.js code (line 72) to work without pre-compiled `.js` files.
- CP 7: Run `./scripts/verify-local.sh all` — static analysis, test suite, and integration gates all pass.
- CP 8: Final Goal Check — verify all six success criteria with concrete evidence (file:line references, test names, command outputs).

## Gates

- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas

- Do not modify `lib/` command implementations (the business logic under `lib/commands/`, `lib/agents/`, `lib/core/`, `lib/review/`, `lib/tools/`)
- Do not modify test assertions or test logic — only file extensions and import paths
- Do not remove or rewrite the `build:cjs` script or the `prepublishOnly` hook
- Do not modify `config/integration-pipelines.json` gate definitions
- Do not change the default `npm run build` (`tsc` → `dist/`)
- Do not modify `eslint.config.mjs` or `tsconfig.json` structure (only add `tsx` as a dependency)

## Stop Rules

- Stop if `tsx --test` proves incompatible with more than 5% of the 100+ test files after conversion, and no loader-based workaround (`tsx/cjs`) resolves the failures.
- Stop if the CLI dynamic command lookup in `index.ts` cannot be made to resolve `.ts` files reliably without introducing a major dependency or architectural change.
- Stop if `./scripts/verify-local.sh static-analysis` fails on changed files due to ESLint or `tsc --noEmit` errors unrelated to the scope changes.
- Stop if converting test files to `.ts` introduces more than 10 test failures that require logic changes (not just import-path fixes).
