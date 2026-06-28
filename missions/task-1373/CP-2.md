# CP-2: gatekeeper.ts Converted

## Summary

Converted `lib/tools/gatekeeper.js` (124 lines) to `lib/tools/gatekeeper.ts` (129 lines with ts-expect-error comment). Changes:
- Replaced 6 `require()` calls with ES `import` statements (fs, path, fmt, mission-utils, backlog, forgejo)
- Replaced `module.exports = {...}` with 4 individual ES `export` statements (DEFAULT_GATEKEEPER_USER, checkMandatoryFiles, buildPushbackBody, runGatekeeper)
- Added explicit TypeScript type annotations to 3 function declarations
- Added `// @ts-expect-error` for forgejo.js import (will be resolved in CP-5)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| tsc --noEmit clean | `npx tsc --noEmit` returns zero errors (verified) |
| test/gatekeeper.test.js passes | 14/14 tests pass, 0 fail (`node --test test/gatekeeper.test.js`) |
| No module.exports remains | `grep -c 'module.exports' lib/tools/gatekeeper.ts` returns 0 |
| No require() remains | `grep -c 'require(' lib/tools/gatekeeper.ts` returns 0 |

## Next action
Convert `lib/tools/sessions.js` to `sessions.ts` (CP-3).
