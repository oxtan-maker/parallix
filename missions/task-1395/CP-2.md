# CP-2: Update px-runner.test.js to use px.ts and --experimental-strip-types

## Work Done

Updated `test/px-runner.test.js` to invoke `px.ts` via `node --experimental-strip-types` instead of `px.js`.

### Changes to `test/px-runner.test.js`

1. **Line 9**: Changed `pxPath` constant from `'px.js'` to `'px.ts'`.
2. **Line 67**: Updated `runPx()` helper to prepend `--experimental-strip-types` flag: `spawnSync(process.execPath, ['--experimental-strip-types', pxPath, ...args], ...)`.
3. **Lines 77-80**: Added `stripNodeWarnings()` helper to filter out Node.js `MODULE_TYPELESS_PACKAGE_JSON` warning lines that include the repo root path in their output, preventing false negatives in the verify-env test's path-leak assertion.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Zero references to `px.js` as file path | `grep "px\.js" test/px-runner.test.js` returns no matches (test/px-runner.test.js:9) |
| Spawn invocations use `--experimental-strip-types` | `['--experimental-strip-types', pxPath, ...args]` at test/px-runner.test.js:67 |
| All tests pass | `node --test test/px-runner.test.js`: 8 pass, 0 fail (test/px-runner.test.js:85-263) |

## Next action
Execute CP-3: Update `test/px-shell-init.test.js` to ESM imports from `px.ts` and `--experimental-strip-types` subprocess spawns.
