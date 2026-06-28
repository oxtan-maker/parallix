# CP-3: sessions.ts Converted

## Summary

Converted `lib/tools/sessions.js` (81 lines) to `lib/tools/sessions.ts` (82 lines). Changes:
- Replaced 2 `require()` calls with ES `import` statements (fs, path)
- Replaced `module.exports = {...}` with 7 individual ES `export` statements
- Added explicit TypeScript type annotations to all 7 function declarations

## Goal Check

| Criterion | Evidence |
|---|---|
| tsc --noEmit clean | `npx tsc --noEmit` reports 0 errors |
| test/sessions.test.js passes (10/10) | readSession returns null when no marker exists, writeSession then readSession returns persisted agent and timestamp, writeSession refuses payload without agent string, shouldResume returns true only when prior agent matches, shouldResume returns false when worktree/slug/role missing, clearSession removes marker file and reports existence, readSession ignores corrupt JSON without throwing, writeSession persists sessionId when provided, writeSession persists null sessionId when not provided, getSessionId returns persisted session ID or null |
| No module.exports remains | `grep -c 'module.exports' lib/tools/sessions.ts` returns 0 |
| No require() remains | `grep -c 'require(' lib/tools/sessions.ts` returns 0 |

## Next action
Convert `lib/tools/redgreen.js` to `redgreen.ts` (CP-4).
