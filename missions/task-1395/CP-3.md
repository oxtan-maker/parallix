# CP-3: Update px-shell-init.test.js to ESM imports from px.ts

## Work Done

Converted `test/px-shell-init.test.js` from CommonJS to ESM and switched all references from `px.js` to `px.ts` with `--experimental-strip-types`.

### Changes to `test/px-shell-init.test.js`

1. **Lines 11-18**: Converted all `require()` calls to ESM `import` statements, including explicit `import test from 'node:test'` (required for ESM since globals aren't injected).
2. **Line 19**: Changed `require('../px.js')` to `import { shellInit } from '../px.ts'`.
3. **Line 22**: Replaced `__dirname` with ESM equivalent via `path.dirname(fileURLToPath(import.meta.url))`; changed `pxJs` constant to `pxTs` pointing to `'px.ts'`.
4. **Lines 72, 93, 114, 143, 174**: Changed all subprocess invocations from `node ${JSON.stringify(pxJs)} shell-init bash` to `node --experimental-strip-types ${JSON.stringify(pxTs)} shell-init bash`.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Imports `shellInit` from `px.ts` (not `px.js`) | `import { shellInit } from '../px.ts'` at test/px-shell-init.test.js:19 |
| All subprocess spawns use `--experimental-strip-types` with `px.ts` | 5 occurrences of `node --experimental-strip-types ${JSON.stringify(pxTs)} shell-init bash` at test/px-shell-init.test.js:72,93,114,143,174 |
| Zero references to `px.js` | `grep "px\.js" test/px-shell-init.test.js` returns no matches |
| All 8 tests pass | `node --test test/px-shell-init.test.js`: 8 pass, 0 fail (test/px-shell-init.test.js:49-186) |

## Next action
Execute CP-4: Run full `npm test` gate to confirm no regressions across the entire test suite.
