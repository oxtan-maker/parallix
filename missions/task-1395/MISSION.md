# Mission: make px.ts the testrunner (task-1395)

## Goal

Update the test suite so that tests validating workflow runtime behavior exercise `px.ts` (the TypeScript source entrypoint) by default using Node.js v24+ native TypeScript support (`--experimental-strip-types`), while keeping `px.js` as an explicit compatibility/package artifact. Specifically:

- `test/px-runner.test.js` must invoke `node --experimental-strip-types px.ts` instead of `node px.js` for all spawn-based assertions
- `test/px-shell-init.test.js` must import `{ shellInit }` from `px.ts` instead of `px.js` and use `node --experimental-strip-types` for subprocess invocations
- `px.ts` must include an ESM import guard so it can be imported as a module without executing the CLI `run()` side effect

## Why Now

task-1391 restored native Node.js v24 strip-only compatibility at the source level, but the surrounding infrastructure (tests, bin path, file manifests) still treats the built CommonJS artifact `px.js` as the primary executable. This creates a mismatch: the TypeScript source entrypoint works, but the authoritative runtime and test paths depend on the generated JS wrapper rather than exercising `px.ts` directly. Aligning the test runner with the source entrypoint closes the gap between what the source declares as the entrypoint and what the tests actually exercise.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: narrow scope with well-known Node.js feature (`--experimental-strip-types`), minimal file changes
- Main drivers: task-1391 enabled the runtime capability; tests and px.ts import guard are the remaining infra gaps

## Scope

Files changed:

1. **`px.ts`** (lines ~267–269): Add an ESM import guard so importing `px.ts` as a module does not trigger the CLI `run()` side effect. The guard must preserve the existing CJS behavior (when `px.js` is the main module, `run()` must still execute).

2. **`test/px-runner.test.js`**: Replace all references to `px.js` with `px.ts` and switch spawn invocations from `node` to `node --experimental-strip-types`. Affected locations:
   - Line 9: `pxPath` constant → `px.ts`
   - Lines 67–71: `runPx()` helper → `node --experimental-strip-types`
   - Line 103: version test assertion for path

3. **`test/px-shell-init.test.js`**: Convert CommonJS `require` to ESM `import` and switch all `node` subprocess invocations to `node --experimental-strip-types`. Affected locations:
   - Line 18: `require('../px.js')` → `import { shellInit } from '../px.ts'`
   - Line 20: `pxJs` constant → `px.ts`
   - Lines 70, 91, 112, 141, 172: subprocess `node ${pxJs}` → `node --experimental-strip-types ${pxTs}`

No changes to any other test files, lib/ source files, or production code paths.

## Out of Scope

- Changing the `package.json` `"bin"` field to point to `px.ts` (px.js remains the published bin)
- Modifying any test file other than `px-runner.test.js` and `px-shell-init.test.js`
- Adding `px.ts` to the `package.json` `"files"` array
- Updating the `pretest` script in `package.json` to build with strip-types (tests run against px.ts directly)
- Changing the TypeScript compilation pipeline or tsconfig
- Running static analysis gates beyond the single `npm test` gate

## Success Criteria

1. `npm test` passes with 0 failures and no regressions in test count (same number of tests run, no new skips caused by these changes)
2. `test/px-runner.test.js` contains zero references to `px.js` as a file path (only `px.ts` invocations remain)
3. `test/px-shell-init.test.js` imports `shellInit` from `px.ts` (not `px.js`) and uses `--experimental-strip-types` for all subprocess spawns
4. `px.ts` exports `shellInit` and `parseArgs` when imported as a module (no CLI side effect on import)
5. `px.ts` still executes `run()` when invoked as the main module via `node px.ts --version` (backward compatibility)
6. All 7 tests in `px-runner.test.js` pass individually (`node --test test/px-runner.test.js`)
7. All 8 tests in `px-shell-init.test.js` pass individually (`node --test --experimental-strip-types test/px-shell-init.test.js`)

## Risks and Assumptions

- **Assumption:** Node.js v22+ `--experimental-strip-types` correctly resolves `.js`-suffixed import paths in `.ts` files to their compiled `.js` counterparts on disk. Verified: `node --experimental-strip-types px.ts --version` works after `npm run build:cjs`.
- **Risk:** The ESM import guard in px.ts could inadvertently suppress `run()` when px.ts is run as the main module via `--experimental-strip-types`. Mitigation: guard checks `import.meta.url` vs `process.argv[1]` so direct execution still triggers `run()`.
- **Risk:** Converting `px-shell-init.test.js` from CJS to ESM could affect test isolation or module caching. Mitigation: each test creates its own temp directories and cleans up in `finally` blocks.
- **Assumption:** Other test files that indirectly exercise px.ts through px.js will continue to pass since px.js is unchanged.
- **Assumption:** The Node.js version in CI/test environments supports `--experimental-strip-types` (requires Node ≥ 22).

## Checkpoints

- CP 1: Add ESM import guard to `px.ts` so it can be imported without triggering `run()` side effect, verified by `node --experimental-strip-types -e "import { shellInit } from './px.ts'"` producing no stderr output
- CP 2: Update `test/px-runner.test.js` to invoke `node --experimental-strip-types px.ts` instead of `node px.js` for all spawn-based assertions
- CP 3: Update `test/px-shell-init.test.js` to ESM imports from `px.ts` and `--experimental-strip-types` subprocess spawns
- CP 4: Full `npm test` gate passes with no regressions

## Gates

- [ ] npm test

## Restricted Areas

- Do not modify any test file other than `test/px-runner.test.js` and `test/px-shell-init.test.js`
- Do not modify `package.json` (bin field, files array, scripts, or any other field)
- Do not modify any file under `lib/`
- Do not modify tsconfig.json or any TypeScript compilation configuration
- Do not modify any other test file in `test/`

## Stop Rules

- Stop immediately if `npm test` produces any new failures compared to the pre-mission baseline
- Stop if the ESM guard in px.ts prevents `run()` from executing when px.ts is invoked as the main module
- Stop if converting px-shell-init.test.js to ESM causes import resolution failures for any node: built-in module
- Stop if any test that was passing before the mission now fails due to these changes
