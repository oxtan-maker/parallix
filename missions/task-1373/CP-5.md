# CP-5: forgejo.ts Converted

## Summary

Converted `lib/tools/forgejo.js` (~1794 lines) to `lib/tools/forgejo.ts` (1793 lines). Changes:
- Replaced ~15 `require()` calls with ES `import` statements (fs, http, https, path, child_process, git, mission-utils, product-config, verification, fmt, backlog)
- Replaced `module.exports = {...}` with ~30 individual ES `export` statements
- Added explicit TypeScript type annotations to all function declarations
- Dynamic requires (`require('../core/mission-utils')` in try/catch, `require('./backlog')` in condition) converted to static ES imports (target modules already converted to TS)
- Reduced `as any` casts from 12 to 5 (reduced redundant casts, used proper type assertions for `pushArgsResult`, fixed `isStaleInfoPushRejection` parameter type to accept `GitResult`)
- Remaining 5 `as any` casts are for JSDoc-defined properties (`_apiError`) not expressible in TS types, and injected function parameters with unknown types
- Added comment documenting `git.git()` → `git()` behavioral change (line 6)

## Goal Check

| Criterion | Evidence |
|---|---|
| tsc --noEmit clean | `npx tsc --noEmit` reports 0 errors |
| test/forgejo.test.js passes | 68 tests pass, 0 fail (`node --test test/forgejo.test.js`) |
| No module.exports remains | `grep -c 'module.exports' lib/tools/forgejo.ts` returns 0 |
| No require() remains | `grep -c 'require(' lib/tools/forgejo.ts` returns 0 |
| as any reduced | `grep -c 'as any' lib/tools/forgejo.ts` returns 5 (was 12, reduced by 58%) |

## Next action
Convert `lib/tools/setup-review.js` to `setup-review.ts` (CP-6).
