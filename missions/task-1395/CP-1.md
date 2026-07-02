# CP-1: ESM Import Guard for px.ts

## Work Done

Added an ESM import guard to `px.ts` so that importing it as a module does not trigger the CLI `run()` side effect, while preserving backward compatibility when px.ts is invoked as the main module.

### Changes to `px.ts`

1. **Line 5**: Added `import { pathToFileURL } from 'node:url';` to support URL comparison.
2. **Lines 16-20**: Updated `resolveRuntimePath()` to check if `process.argv[1]` ends with `/px.ts` or `/px.js` before using it; falls back to `path.resolve(process.cwd(), 'px.ts')` when px.ts is imported by another module.
3. **Lines 269-273**: Replaced the original CJS-only guard with a dual CJS/ESM guard:
   - `_cjsMain`: Checks `require.main === module` for CommonJS execution (preserves px.js behavior).
   - `_esmMain`: Checks if `process.argv[1]` ends with `/px.ts` for ES module execution.
   - `run()` is triggered when either guard matches.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `node --experimental-strip-types -e "import { shellInit } from './px.ts'"` produces no run() output | `node --experimental-strip-types -e "import { shellInit } from './px.ts'; console.log('IMPORT_OK')"` → prints `IMPORT_OK` with no version output (px.ts:269-273) |
| `node --experimental-strip-types px.ts --version` triggers run() and prints version | Output: `@magnusekdahl/parallix 1.3.2`, `px: /home/magnus/code/parallix-task-1395/px.ts` (px.ts:269-273) |
| `node px.js --version` still works (CJS backward compat) | Output: `px: /home/magnus/code/parallix-task-1395/px.js` (px.ts:269, CJS guard) |

## Next action
Execute CP-2: Update `test/px-runner.test.js` to invoke `node --experimental-strip-types px.ts` instead of `node px.js`.
