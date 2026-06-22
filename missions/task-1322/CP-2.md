# CP-2: Opencode Launcher Fix Implemented and Tested

## Work Summary

Modified `lib/agents/opencode.js` to detect "Session not found" in spawn results and retry without the `-s` flag:

- Added `isStaleSessionResult()` helper that checks both stderr and stdout for "Session not found"
- Added `staleSessionHandler()` wrapper that intercepts spawn results, clears the stale session marker via `sessions.clearSession()`, and retries with `resume: false`
- Added `slug` and `role` parameters to `startOpencodeAgent` for session clearing
- Added `__setSessionsForTest` test hook for dependency injection
- Updated `lib/agents/agents.js:715` to pass `slug` and `role` to launcher

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Stale session detected in stderr | `lib/agents/opencode.js:59` (stderr.includes('Session not found')) |
| Stale session detected in stdout | `lib/agents/opencode.js:60` (stdout.includes('Session not found')) |
| Stale session marker cleared | `lib/agents/opencode.js:96` (_sessions.clearSession(worktree, slug, role)) |
| Retry without -s flag | `lib/agents/opencode.js:98` (buildOpencodeInvocation({ resume: false, sessionId: null })) |
| Healthy resume unchanged | Test: `startOpencodeAgent healthy resume still uses -s flag` (test/opencode.test.js:188) |
| No retry when resume=false | Test: `startOpencodeAgent does NOT retry when resume is false` (test/opencode.test.js:173) |
| All existing tests pass | npm test: 1566 pass, 0 fail |

## Next action: Implement Claude and Codex launcher fixes with the same pattern (CP-3).
