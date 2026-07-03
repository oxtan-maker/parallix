# CP-3: Reason Field in updateAgentBlock

## Work Done

1. Extended `updateAgentBlock` signature to accept `{targetPath?, reason?}` options
2. Changed persisted entry from `{ until }` to `{ until, reason: options.reason }`
3. Threaded existing `blockReason` variable into the launch-failure blocklist write path
4. Added 2 new tests asserting `{ until, reason }` shape in persisted JSON

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Signature accepts reason option | `lib/agents/agents.ts:572` → `options: {targetPath?: string, reason?: string} = {}` |
| Persisted entry includes reason | `lib/agents/agents.ts:603` → `payload.blocklist[agent] = { until, reason: options.reason }` |
| Launch failure path threads blockReason | `lib/agents/agents.ts:934` → `updateAgentBlockFn(chosen || '', blockUntil, { reason: blockReason })` |
| Test: reason persisted as { until, reason } | `test/agents-limit-hit.test.js:258-269` → asserts `result.blocklist.codex.reason === 'transient crash'` |
| Test: limit-hit reason with description | `test/agents-limit-hit.test.js:271-281` → asserts reason includes `'weekly usage limit reached'` |
| All 29 tests pass | `node --test test/agents-limit-hit.test.js` — 29 pass, 0 fail |

## Next action
Add `reason` field to `detectLimitHit`'s return value and thread it through the limit-hit block path in `startAgent` (CP-4).
