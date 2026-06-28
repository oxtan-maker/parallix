# CP-4: redgreen.ts Converted

## Summary

Converted `lib/tools/redgreen.js` (220 lines) to `lib/tools/redgreen.ts` (224 lines). Changes:
- Replaced 6 `require()` calls with ES `import` statements (fs, os, path, fmt, mission-utils, git)
- Replaced `module.exports = {...}` with 4 individual ES `export` statements
- Added explicit TypeScript type annotations to all 4 function declarations
- CLI guard: kept CJS-style `require.main === module` check (compatible with `build:cjs` CJS output)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| tsc --noEmit clean | `npx tsc --noEmit` returns zero errors (verified) |
| test/redgreen.test.js passes | 9/9 tests pass, 0 fail (`node --test test/redgreen.test.js`) |
| No module.exports remains | `grep -c 'module.exports' lib/tools/redgreen.ts` returns 0 |
| No require() remains | `grep -c 'require(' lib/tools/redgreen.ts` returns 0 |

## Next action
Convert `lib/tools/forgejo.js` to `forgejo.ts` (CP-5).
