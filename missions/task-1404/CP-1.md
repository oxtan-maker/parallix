# CP-1: Failing Reproduction Test

## Work Done

Added 5 new reproduction tests to `test/agents-limit-hit.test.js` that simulate non-quota failure shapes for Codex and Mistral:

1. WebSocket connection failure with "os error 1"
2. Connection refused errors
3. ECONNREFUSED errors
4. Provider endpoint unreachable errors
5. Generic endpoint unreachable errors

Each test asserts `shouldPersistLaunchFailureBlock(agent, result)` returns `false`, preventing persistent blocklist poisoning for transient connectivity issues.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Test authored for websocket/os error 1 | `test/agents-limit-hit.test.js:649-652` |
| Test authored for connection refused | `test/agents-limit-hit.test.js:654-656` |
| Test authored for ECONNREFUSED | `test/agents-limit-hit.test.js:658-660` |
| Test authored for provider unreachable | `test/agents-limit-hit.test.js:662-664` |
| Test authored for endpoint unreachable | `test/agents-limit-hit.test.js:666-668` |
| All 5 tests fail (red) before fix | `node --test test/agents-limit-hit.test.js` shows `actual: true, expected: false` for all 5 |

## Next action
Add the three new regex pattern groups to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` in `lib/agents/agents.ts` (CP-2).
