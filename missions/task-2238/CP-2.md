# CP-2: Replace Direct Pi Client with Pi SDK

## Summary

Replaced the direct Pi CLI invocation in `lib/agents/pi.ts` with the Pi SDK (`@earendil-works/pi-coding-agent`). The `startPiAgent()` function now creates an SDK `AgentSession` via `createAgentSession()` instead of spawning `pi --print --mode json` through `spawnAndTee`. The caller-facing `{ invocation, resultPromise }` contract is preserved — `lib/agents/agents.ts` and `lib/agents/launcher-selection.ts` require zero changes.

### Key Changes

1. **`lib/agents/pi.ts`** — Rewrote to use SDK:
   - Imports `createAgentSession`, `SessionManager`, `AuthStorage`, `ModelRegistry` from `@earendil-works/pi-coding-agent` via dynamic import (ESM-only SDK in CJS context)
   - `startPiAgent()` creates SDK session, subscribes to events (`message_update.text_delta`, `tool_execution_end`, `agent_end`), calls `session.prompt()` + `session.waitForIdle()`, and assembles result from session state
   - `buildPiInvocation()` returns synthetic invocation for logging; `resolvePiCommand()` preserved with full path resolution
   - Test hooks `__setSpawnAndTeeForTest` translate spawn mocks into SDK session mocks
   - Legacy parsers (`extractPiSessionId`, `extractPiTelemetry`) kept for backwards compatibility

2. **`package.json`** — Added `@earendil-works/pi-coding-agent: ^0.80.6` as a dependency

3. **`tsconfig.json`** — Added `skipLibCheck: true` to handle SDK nested dependency type resolution issues (pre-existing in SDK, not introduced by this change)

### Preserved Behaviors

- Request inputs (prompt, worktree, env, resume, sessionId, model) — unchanged
- Cancellation/error propagation — SDK errors map to same `{ status, stderr, error, signal }` shape
- Retry logic — transient failure detection and retry preserved
- Telemetry extraction — from `getSessionStats()` instead of stdout parsing
- Session ID — from `session.sessionId` instead of stdout header parsing
- Health probe — `resolvePiCommand()` still resolves binary for `pi --help` probe

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Pi agent has no production direct-client invocation at its former boundary | `lib/agents/pi.ts:291-375` (`startPiAgent` uses `createAgentSession` + `session.prompt()`) | PASS |
| Request inputs preserved | `lib/agents/pi.ts:263-279` (`StartPiAgentOptions` interface unchanged) | PASS |
| Completion path preserved | `lib/agents/pi.ts:335-352` (result shape: `{ status, stdout, stderr, sessionId, telemetry, model, provider, transientRetries }`) | PASS |
| Cancellation/error semantics preserved | `lib/agents/pi.ts:353-388` (catch block with retry logic + error mapping) | PASS |
| Focused tests pass | `test/pi-runner.test.js` — 21/21 tests pass (all `resolvePiCommand`, `buildPiInvocation`, `extractPiSessionId`, `extractPiTelemetry`, failure classification, and `startPiAgent` tail-buffer tests) | PASS |
| No changes outside Pi integration boundary | Only `lib/agents/pi.ts`, `package.json`, `tsconfig.json` changed; `lib/agents/agents.ts`, `lib/agents/launcher-selection.ts` untouched | PASS |
| Full test suite passes | `./scripts/verify-local.sh all` — 2156/2181 pass, 0 fail, 25 skipped | PASS |

**Next action:** Implement output selection so only the final Pi assistant response is presented to the user, and add focused coverage for event chatter suppression (CP-3).
