# CP-1: backlog.ts Converted

## Summary

Converted `lib/tools/backlog.js` (834 lines) to `lib/tools/backlog.ts` (835 lines). Changes:
- Replaced 6 `require()` calls with ES `import` statements (fs, path, git, WORKFLOW_AGENT_NAMES, fmt, resolveTaskStorage)
- Replaced `module.exports = {...}` with 24 individual ES `export` statements
- Added explicit TypeScript type annotations to all 20+ function declarations and arrow function parameters
- Fixed inline JSDoc `@type` casts to TypeScript `as` assertions where needed
- Preserved all 21 exported names plus internal helpers (parseAssigneeFamilies, clearTaskAgentAssignee)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| tsc --noEmit clean | `npx tsc --noEmit` returns zero errors (verified) |
| test/backlog.test.js passes | 58/58 tests pass, 0 fail (`node --test test/backlog.test.js`) |
| No module.exports remains | `grep -c 'module.exports' lib/tools/backlog.ts` returns 0 |
| No require() remains | `grep -c 'require(' lib/tools/backlog.ts` returns 0 |
| All exports preserved | 24 ES export statements present (21 original + parseAssigneeFamilies + clearTaskAgentAssignee) |

## Next action
Convert `lib/tools/gatekeeper.js` to `gatekeeper.ts` (CP-2).
