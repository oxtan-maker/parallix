# CP-1: Map Pi Agent Call Chain and SDK-to-Contract Mapping

## Summary

Mapped the complete Pi agent execution path, identified the direct-client boundary, documented the caller-facing result contract, and recorded the intended SDK-to-existing-contract mapping before any code changes.

### Current Pi Agent Call Chain

1. **`lib/agents/launcher-selection.ts`** — `LAUNCHERS` map registers `pi: startPiAgent`; `RESOLVERS` registers `pi: resolvePiCommand`. Health probe uses `pi --help`.
2. **`lib/agents/pi.ts`** — Core Pi agent module:
   - `startPiAgent()` (line 269) — Main entry; returns `{ invocation, resultPromise }`
   - `buildPiInvocation()` (line 109) — Builds CLI args: `pi --print --mode json --approve [--model M] [--continue|--session-id S] <prompt>`
   - `resolvePiCommand()` (line 79) — Resolves `pi` binary from `PI_BIN`, `NVM_BIN`, `process.execPath` neighbor, PATH, well-known paths
   - Uses `spawnAndTee()` from `lib/core/spawn-tee.ts` with `maxTailBytes: 32MB` (line 294)
   - Parses JSON stream in `extractPiSessionId()` (line 187) and `extractPiTelemetry()` (line 203)
   - Retry logic: `shouldRetryPiFailure()` (line 170), `isHardPiFailure()` (line 158), `isTransientPiFailure()` (line 166)
3. **`lib/agents/agents.ts`** — `startAgent()` (line 107) orchestrates launcher selection, calls `launcher({ prompt, worktree, env, resume, sessionId, model, slug, role, teeOptions })`, receives `{ invocation, resultPromise }`, awaits result.
4. **`lib/commands/draft.ts`** — `startDraftAgentFn()` calls `startAgent('draft', ...)`, uses `result` for status/error checks (lines 283-299).
5. **`lib/review/review-loop.ts`** — Uses agent result `stdout`/`stderr` for review output (lines 310-311).

### Direct-Client Execution Boundary

- **File:** `lib/agents/pi.ts`
- **CLI invocation:** `pi --print --mode json --approve [prompt]` (line 112-128)
- **Spawn:** `spawnAndTee()` with `stdio: 'inherit'` (line 130) — though spawn-tee internally uses `['inherit', 'pipe', 'pipe']` and tees stdout to `process.stdout`
- **Chatty output root cause:** `pi --mode json` emits one JSON line per token/delta. Real sessions reach 18.6MB. All JSON events (session header, token deltas, tool events, message_end) are teed to `process.stdout`, making the entire JSON stream visible to the user.

### Caller-Facing Result Contract

`startPiAgent()` returns:
```
{
  invocation: { command: string, args: string[], options: { stdio, cwd, env } },
  resultPromise: Promise<{
    status: number | null,
    stdout: string,
    stderr: string,
    error: unknown | null,
    signal: string | null,
    sessionId: string | undefined,
    telemetry: { provider, model, inputTokens, outputTokens, cachedTokens, totalTokens, toolCalls, usagePercent },
    model: string | undefined,
    provider: string | undefined,
    transientRetries: number,
    startedAt: string,
    endedAt: string
  }>
}
```

This contract is consumed by `lib/agents/agents.ts:startAgent()` which expects `{ invocation, resultPromise }` from all launchers. The result is used for:
- Status/error checking (agents.ts lines 310-340)
- Limit-hit detection (agents.ts line 310)
- Session persistence (agents.ts line 355)
- Telemetry recording (draft.ts line 1019)

### Existing Test Locations

| Test File | Coverage |
|-----------|----------|
| `test/pi-runner.test.js` | `startPiAgent` tail buffer, `resolvePiCommand`, `buildPiInvocation`, `extractPiSessionId`, `extractPiTelemetry`, failure classification |
| `test/e2e-real-agent-smoke.test.js` | Real agent smoke (opencode + pi), end-to-end lifecycle |
| `test/task-2236-pi-e2e-repro.test.js` | Pi e2e test forwarding and fixture setup |
| `test/agents.test.js` | Agent selection, launcher availability, blocklist |

### Existing Documentation

| Doc | Pi Coverage |
|-----|-------------|
| `docs/operator-setup.md` (lines 33-121) | Pi Agent Setup, vLLM config, custom runner switch, Graphify on Pi |
| `docs/real-agent-smoke.md` | Real agent smoke test docs (mentions pi as custom runner) |
| `docs/use-cases.md` | Use cases mentioning Pi |

### SDK-to-Existing-Contract Mapping

The Pi SDK (`@earendil-works/pi-coding-agent`) at `/home/magnus/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent` exposes:

| SDK API | Current Direct-Client | Mapping |
|---------|----------------------|---------|
| `createAgentSession({ cwd, sessionManager, model, ... })` | `spawnAndTee(pi, args, options)` | Replace spawn with SDK session creation |
| `session.subscribe(event => ...)` | JSON line parsing from stdout | Collect `text_delta` for stdout; `tool_execution_*` for telemetry |
| `session.prompt(prompt)` | `pi --print --mode json --approve <prompt>` | SDK prompt replaces CLI positional arg |
| `agent_end` event with `messages[]` | `extractPiSessionId()` + `extractPiTelemetry()` | Derive sessionId, telemetry from event payload |
| `message_update` with `text_delta` | Full JSON stream (chatty) | **Only text_delta collected as user-facing stdout** |
| `SessionManager.inMemory()` | No session persistence needed for one-shot | Use in-memory session manager |
| `AuthStorage.create()` + `ModelRegistry.create()` | Implicit via `pi` CLI auth | Explicit SDK auth setup |

### Key Design Decisions

1. **Preserve `startPiAgent()` signature:** The `{ invocation, resultPromise }` return shape and `StartPiAgentOptions` interface are preserved so `lib/agents/agents.ts` and `lib/agents/launcher-selection.ts` require zero changes.
2. **Output filtering:** Only `text_delta` events from `message_update` are assembled into `result.stdout`. Tool events, session headers, and other JSON chatter are excluded from the user-facing result.
3. **Invocation object:** The `invocation` returned is synthetic (`{ command: 'pi (SDK)', args: [...], options: { cwd } }`) for logging purposes — callers use it only for display.
4. **Telemetry extraction:** Moved from stdout parsing to `agent_end` event message usage fields.
5. **Error handling:** SDK errors map to the same `{ status, stderr, error }` shape expected by `startAgent()`.
6. **Restricted areas preserved:** No changes to `lib/agents/agents.ts`, `lib/agents/launcher-selection.ts`, `lib/core/spawn-tee.ts`, or any non-Pi launcher.

### Files to Change

| File | Change |
|------|--------|
| `lib/agents/pi.ts` | Replace CLI spawn with SDK `createAgentSession` + `session.prompt()` |
| `test/pi-runner.test.js` | Update tests for SDK-based execution; add output filtering coverage |
| `docs/operator-setup.md` | Update if Pi integration description changes |
| `package.json` | Add `@earendil-works/pi-coding-agent` as a dependency (currently global-only) |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Pi agent call chain mapped | `lib/agents/pi.ts:269` (`startPiAgent`), `lib/agents/launcher-selection.ts:33` (`pi: startPiAgent`), `lib/agents/agents.ts:107` (`startAgent`) | PASS |
| Direct-client boundary identified | `lib/agents/pi.ts:112-128` (`buildPiInvocation` CLI args), `lib/agents/pi.ts:130` (`stdio: 'inherit'`), `lib/agents/pi.ts:294` (`spawnAndTee` with 32MB tail) | PASS |
| Caller-facing result contract documented | `lib/agents/pi.ts:269-370` (`StartPiAgentOptions`/return shape), `lib/agents/agents.ts:310-355` (result consumption) | PASS |
| Existing test locations recorded | `test/pi-runner.test.js`, `test/e2e-real-agent-smoke.test.js`, `test/task-2236-pi-e2e-repro.test.js` | PASS |
| Existing documentation locations recorded | `docs/operator-setup.md:33-121`, `docs/real-agent-smoke.md:53-56` | PASS |
| SDK-to-contract mapping recorded | SDK Quick Reference in `@earendil-works/pi-coding-agent/examples/sdk/README.md`, mapping table above | PASS |
| Restricted areas identified | `lib/agents/agents.ts`, `lib/agents/launcher-selection.ts`, `lib/core/spawn-tee.ts`, non-Pi launchers — no changes planned | PASS |

**Next action:** Replace the direct Pi CLI invocation in `lib/agents/pi.ts` with `createAgentSession` from the Pi SDK, preserving the `startPiAgent()` return contract and all request/resume/cancellation/error behavior (CP-2).
