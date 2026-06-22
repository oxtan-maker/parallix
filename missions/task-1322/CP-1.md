# CP-1: Root Cause Traced and Documented

## Work Summary

Mapped the full session marker lifecycle from creation through launcher invocation:

1. **Creation** (`lib/agents/agents.js:828`): After successful launch (status 0), `sessions.writeSession()` writes marker to `.workflow/sessions/<slug>-<role>.json`
2. **Resume decision** (`lib/agents/agents.js:679-683`): `sessions.shouldResume()` checks marker matches chosen agent
3. **Session ID retrieval** (`lib/agents/agents.js:684`): `sessions.getSessionId()` reads stored `sessionId`
4. **Launcher invocation** (`lib/agents/opencode.js:35`, `lib/agents/claude.js:50`, `lib/agents/codex.js:31`): Each launcher adds resume flag when `resume=true` + `sessionId` present
5. **Clear** (`lib/tools/sessions.js:58-64`): `sessions.clearSession()` removes marker file

**Root cause**: When opencode exits with "Session not found" (status 1), `agents.js:801-822` retries with next agent. But all RESUME_CAPABLE agents share the same stale session marker file, so claude/codex also get "Session not found" and fail identically.

**Fix strategy**: Each launcher detects "Session not found" in spawn result, clears the stale marker via `sessions.clearSession()`, and retries the launch without the resume flag.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Session marker lifecycle mapped | `lib/agents/agents.js:828` (writeSession), `lib/tools/sessions.js:53` (getSessionId), `lib/agents/opencode.js:35` (-s flag), `lib/agents/claude.js:50` (--resume flag), `lib/agents/codex.js:31` (exec resume) |
| Stale session identified as root cause | `lib/agents/agents.js:801` (launchFailed detection), `lib/tools/sessions.js:53` (shared marker file) |

## Next action: Implement opencode launcher stale session detection and retry (CP-2).
