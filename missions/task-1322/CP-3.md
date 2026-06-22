# CP-3: Claude and Codex Launcher Fixes Implemented and Tested

## Work Summary

Applied the same stale session detection and retry pattern to `lib/agents/claude.js` and `lib/agents/codex.js`:

**Claude (`lib/agents/claude.js`)**:
- Added `isStaleSessionResult()` checking stderr and stdout for "Session not found"
- Added `staleSessionHandler()` wrapping `spawnAndTee` to detect stale sessions, clear marker, retry without `--resume`
- Added `__setSpawnAndTeeForTest` and `__setSessionsForTest` test hooks
- Added `slug` and `role` parameters to `startClaudeAgent`

**Codex (`lib/agents/codex.js`)**:
- Added `isStaleSessionResult()` checking stderr and stdout for "Session not found"
- Added `staleSessionHandler()` wrapping `spawnAndTee` to detect stale sessions, clear marker, retry without `exec resume`
- Added `__setSpawnAndTeeForTest` and `__setSessionsForTest` test hooks
- Added `slug` and `role` parameters to `startCodexDraftAgent`

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Claude stale session detected | `lib/agents/claude.js:77` (stderr.includes('Session not found') || stdout.includes('Session not found')) |
| Claude stale session marker cleared | `lib/agents/claude.js:83` (_sessions.clearSession(worktree, slug, role)) |
| Claude retry without --resume | `lib/agents/claude.js:85` (buildClaudeInvocation({ resume: false, sessionId: null })) |
| Codex stale session detected | `lib/agents/codex.js:85` (stderr.includes('Session not found') || stdout.includes('Session not found')) |
| Codex stale session marker cleared | `lib/agents/codex.js:91` (_sessions.clearSession(worktree, slug, role)) |
| Codex retry without exec resume | `lib/agents/codex.js:93` (buildCodexDraftInvocation({ resume: false, sessionId: null })) |
| Claude healthy resume unchanged | Test: `startClaudeAgent healthy resume still uses --resume flag` (test/claude.test.js:258) |
| Codex healthy resume unchanged | Test: `startCodexDraftAgent healthy resume still uses exec resume` (test/codex.test.js:229) |
| Claude no retry when resume=false | Test: `startClaudeAgent does NOT retry when resume is false` (test/claude.test.js:243) |
| Codex no retry when resume=false | Test: `startCodexDraftAgent does NOT retry when resume is false` (test/codex.test.js:214) |
| All existing tests pass | npm test: 1566 pass, 0 fail |

## Next action: Run full test suite and verify all gates pass (CP-4).
