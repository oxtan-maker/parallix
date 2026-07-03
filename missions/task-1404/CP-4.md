# CP-4: Reason Field in detectLimitHit

## Work Done

1. Added `reason` field to `detectLimitHit` return value:
   - `source === 'parsed'`: `"parsed: <regex pattern source>"`
   - `source === 'fallback'`: `"fallback: usage limit reached"`
   - `source === 'sigint'`: `"sigint: process terminated by <signal>"`
2. Threaded `limitHit.reason` through the limit-hit block path in `startAgent`
3. Added 4 new tests in `test/limit-hit.test.js` validating the `reason` field

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Reason for parsed source | `lib/agents/limit-hit.ts:227` → `reason = \`parsed: ${match.pattern.source}\`` |
| Reason for fallback source | `lib/agents/limit-hit.ts:231` → `reason = 'fallback: usage limit reached'` |
| Reason for sigint source | `lib/agents/limit-hit.ts:238` → `reason = \`sigint: process terminated by ${signal}\`` |
| Return includes reason | `lib/agents/limit-hit.ts:245` → `return { until: formatBlockUntil(ceiled), source, reason }` |
| Limit-hit path threads reason | `lib/agents/agents.ts:862` → `updateAgentBlockFn(chosen || '', limitHit.until, { reason: limitHit.reason })` |
| Test: reason for parsed source | `test/limit-hit.test.js:277-280` → `assert.ok(result.reason.startsWith('parsed:'))` |
| Test: reason for fallback source | `test/limit-hit.test.js:282-294` → `assert.ok(result.reason.includes('usage limit reached'))` |
| Test: reason for sigint source | `test/limit-hit.test.js:296-308` → `assert.ok(result.reason.includes('SIGINT'))` |
| Test: reason field present for all patterns | `test/limit-hit.test.js:310-323` → `assert.equal(typeof result.reason, 'string')` |
| All limit-hit tests pass | `node --test test/limit-hit.test.js` — 32 pass, 0 fail |
| All agents-limit-hit tests pass | `node --test test/agents-limit-hit.test.js` — 29 pass, 0 fail |

## Next action
Run `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` verification gates (CP-5).
