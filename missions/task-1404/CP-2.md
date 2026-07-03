# CP-2: New Regex Patterns for Non-Blocking Errors

## Work Done

Added three new groups of regex patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` (and compiled `agents.js`):

1. **Websocket/connection failures** (4 patterns): `failed to connect to websocket`, `connection refused`, `ECONNREFUSED`, `os error 1`
2. **Provider reachability errors** (3 patterns): `provider endpoints are unreachable`, `reachability`, `endpoint unreachable`
3. **Generic os-error/transient failures** (1 pattern): `os error \d+`

All 5 reproduction tests from CP-1 now pass (27/27 green).

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Websocket pattern added | `lib/agents/agents.ts:127` → `/failed to connect to websocket/i` |
| Connection refused pattern added | `lib/agents/agents.ts:128` → `/\bconnection refused\b/i` |
| ECONNREFUSED pattern added | `lib/agents/agents.ts:129` → `/\bECONNREFUSED\b/i` |
| OS error 1 pattern added | `lib/agents/agents.ts:130` → `/\bos error 1\b/i` |
| Provider unreachable pattern added | `lib/agents/agents.ts:132` → `/provider endpoints are unreachable/i` |
| Reachability pattern added | `lib/agents/agents.ts:133` → `/\breachability\b/i` |
| Endpoint unreachable pattern added | `lib/agents/agents.ts:134` → `/\bendpoint unreachable\b/i` |
| Generic os-error pattern added | `lib/agents/agents.ts:136` → `/\bos error \d+\b/i` |
| All 5 reproduction tests pass | `test/agents-limit-hit.test.js:649-672` — 27/27 pass, 0 fail |
| Existing tests still pass | ECONNRESET, SIGKILL, custom agent, config errors all green |

## Next action
Add `reason` field to `updateAgentBlock`'s persisted entry and thread the existing `blockReason` into it (CP-3).
