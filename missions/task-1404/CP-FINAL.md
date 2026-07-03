# Final Checkpoint: task-1404 Complete

## Summary

Completed all 5 checkpoints for mission task-1404: "stop false Codex/Mistral autoblocks and persist blocklist reasons".

### Changes Made

1. **`lib/agents/agents.ts`** (+7 new regex patterns, reason threading)
   - Added 8 new patterns to `NON_BLOCKING_LAUNCH_ERROR_PATTERNS` covering websocket/connection failures, provider reachability errors, and generic os-error transient failures
   - Extended `updateAgentBlock` signature to accept `{targetPath?, reason?}` options
   - Changed persisted blocklist entry from `{ until }` to `{ until, reason: options.reason }`
   - Threaded `blockReason` through launch-failure block path
   - Threaded `limitHit.reason` through limit-hit block path

2. **`lib/agents/limit-hit.ts`** (reason field in return value)
   - Added `reason` field to `detectLimitHit` return value
   - `parsed` source: `"parsed: <regex pattern source>"`
   - `fallback` source: `"fallback: usage limit reached"`
   - `sigint` source: `"sigint: process terminated by <signal>"`

3. **`test/agents-limit-hit.test.js`** (+9 new tests)
   - 5 reproduction tests for non-quota failure shapes (websocket/os error 1, connection refused, ECONNREFUSED, provider unreachable, endpoint unreachable)
   - 2 tests for `updateAgentBlock` reason persistence

4. **`test/limit-hit.test.js`** (+4 new tests)
   - Tests for `reason` field in parsed, fallback, and sigint sources
   - Updated existing test to also validate `reason` presence

## Goal Check

### SC 1: Non-blocking patterns cover remaining false-block error shapes

| Pattern Group | File:Line | Test |
|---------------|-----------|------|
| websocket/connection failures (4 patterns) | `lib/agents/agents.ts:127-130` | `shouldPersistLaunchFailureBlock returns false for websocket connection failure (os error 1)` — `test/agents-limit-hit.test.js:649` |
| provider reachability errors (3 patterns) | `lib/agents/agents.ts:132-134` | `shouldPersistLaunchFailureBlock returns false for provider endpoint unreachable` — `test/agents-limit-hit.test.js:662` |
| generic os-error/transient failures (1 pattern) | `lib/agents/agents.ts:136` | `shouldPersistLaunchFailureBlock returns false for connection refused` — `test/agents-limit-hit.test.js:654` |
| ECONNREFUSED | `lib/agents/agents.ts:129` | `shouldPersistLaunchFailureBlock returns false for ECONNREFUSED` — `test/agents-limit-hit.test.js:658` |
| endpoint unreachable | `lib/agents/agents.ts:134` | `shouldPersistLaunchFailureBlock returns false for endpoint unreachable` — `test/agents-limit-hit.test.js:666` |

### SC 2: updateAgentBlock persists reason field

| Evidence | File:Line |
|----------|-----------|
| Signature accepts reason option | `lib/agents/agents.ts:572` → `options: {targetPath?: string, reason?: string} = {}` |
| Persisted entry includes reason | `lib/agents/agents.ts:603` → `payload.blocklist[agent] = { until, reason: options.reason }` |
| Test: reason persisted in JSON | `test/agents-limit-hit.test.js:258` → `assert.equal(result.blocklist.codex.reason, 'transient crash')` |
| Test: reason in limit-hit entry | `test/agents-limit-hit.test.js:271` → `assert.ok(written.blocklist.claude.reason.includes('weekly usage limit reached'))` |

### SC 3: detectLimitHit returns { until, source, reason }

| Evidence | File:Line |
|----------|-----------|
| Reason for parsed source | `lib/agents/limit-hit.ts:227` → `reason = \`parsed: ${match.pattern.source}\`` |
| Reason for fallback source | `lib/agents/limit-hit.ts:231` → `reason = 'fallback: usage limit reached'` |
| Reason for sigint source | `lib/agents/limit-hit.ts:238` → `reason = \`sigint: process terminated by ${signal}\`` |
| Return value includes reason | `lib/agents/limit-hit.ts:245` → `return { until: formatBlockUntil(ceiled), source, reason }` |
| Test: reason for parsed | `test/limit-hit.test.js:277` → `assert.ok(result.reason.startsWith('parsed:'))` |
| Test: reason for fallback | `test/limit-hit.test.js:282` → `assert.ok(result.reason.includes('usage limit reached'))` |
| Test: reason for sigint | `test/limit-hit.test.js:296` → `assert.ok(result.reason.includes('SIGINT'))` |

### SC 4: Existing limit-hit behavior preserved

| Evidence | File:Line | Test |
|----------|-----------|------|
| Real quota events still block | `lib/agents/limit-hit.ts:218-228` | `startAgent persists a block via updateAgentBlock when limit-hit detector fires` — `test/agents-limit-hit.test.js:117` |
| ECONNRESET still blocks (transient) | `lib/agents/agents.ts:136` | `shouldPersistLaunchFailureBlock returns true for transient crashes (ECONNRESET)` — `test/agents-limit-hit.test.js:625` |
| SIGKILL still blocks (signal) | `lib/agents/agents.ts:136` | `shouldPersistLaunchFailureBlock returns true for signal kills (SIGKILL)` — `test/agents-limit-hit.test.js:633` |
| Custom agent never blocks | `lib/agents/agents.ts:179` | `shouldPersistLaunchFailureBlock returns false for custom agent regardless of failure` — `test/agents-limit-hit.test.js:639` |

### SC 5: All tests pass, static analysis clean

| Gate | Result | Evidence |
|------|--------|----------|
| ESLint | PASS | `./scripts/verify-local.sh static-analysis` — "PASS: ESLint clean" |
| tsc typecheck | PASS | `./scripts/verify-local.sh static-analysis` — "PASS: tsc typecheck clean" |
| Test hygiene | PASS | `./scripts/verify-local.sh static-analysis` — "PASS: test-hygiene clean" |
| Full test suite | PASS | `./scripts/verify-local.sh all` — "1856 pass, 0 fail, 22 skipped" |
| Docs | PASS | `./scripts/verify-local.sh docs` — "PASS: all required documentation present" |

## Files Changed

- `lib/agents/agents.ts` — extended patterns, added reason to updateAgentBlock, threaded reason through both block paths
- `lib/agents/agents.js` — compiled from agents.ts
- `lib/agents/limit-hit.ts` — added reason field to detectLimitHit return value
- `lib/agents/limit-hit.js` — compiled from limit-hit.ts
- `test/agents-limit-hit.test.js` — 9 new tests
- `test/limit-hit.test.js` — 4 new tests + updated existing test

## Next action
Commit all changes and submit for review.
