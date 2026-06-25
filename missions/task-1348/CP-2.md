# CP-2: Add updateAgentBlockFn in launchFailed Branch

## Work Done

Modified `lib/agents/agents.js` with two changes:

### 1. Import `formatBlockUntil` and `DEFAULT_FALLBACK_HOURS` from limit-hit.js (line 9)

```javascript
// Before:
const { detectLimitHit } = require('./limit-hit');

// After:
const { detectLimitHit, formatBlockUntil, DEFAULT_FALLBACK_HOURS } = require('./limit-hit');
```

### 2. Added blocking logic in `launchFailed` branch (agents.js:823-834)

After `launched.add(chosen)` and before `chosen = null; continue;`, added:

```javascript
// Block non-qwen agents on non-limit failures so selectAgent excludes them
// on the next retry iteration, and the review-loop fallback path can activate.
// qwen (opencode/local AI) is excluded — exit 1 is a temporary local error.
if (chosen !== 'qwen') {
  const blockUntil = formatBlockUntil(new Date(Date.now() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000));
  try {
    const blockResult = updateAgentBlockFn(chosen, blockUntil);
    log(fmt.status('INFO', `Wrote blocklist entry for ${fmt.agent(chosen)} -> ${fmt.path(blockResult.path)} (${DEFAULT_FALLBACK_HOURS}h block)`));
  } catch (err) {
    log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(chosen)}: ${err.message}`));
  }
}
```

Key design decisions:
- Uses `DEFAULT_FALLBACK_HOURS` (1 hour) from limit-hit.js — consistent with rate-limit blocks
- Uses `formatBlockUntil` to produce the `"YYYY-MM-DD HH"` format required by `updateAgentBlock`
- Excludes `qwen` (opencode/local AI) — exit 1 is a temporary local error, not persistent
- Wrapped in try/catch with WARN log — matches existing pattern at agents.js:764-769
- Placed in the `launchFailed` branch (agents.js:806+) as specified in the mission
- Does NOT modify `limit-hit.js`, `review-loop.js`, `updateAgentBlock`, or any prompt templates

## Goal Check

| Success Criterion | Evidence |
|-------------------|----------|
| SC1: `startAgent` calls `updateAgentBlockFn` in launchFailed for non-limit failures | `lib/agents/agents.js:829` — `updateAgentBlockFn(chosen, blockUntil)` inside `if (launchFailed)` |
| SC2: Agent with non-limit error gets written to blocklist | `lib/agents/agents.js:829` — calls `updateAgentBlockFn(chosen, blockUntil)` |
| SC3: Block duration defaults to 1 hour via DEFAULT_FALLBACK_HOURS | `lib/agents/agents.js:827` — `DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000` |
| SC4: `qwen` excluded from non-limit block logic | `lib/agents/agents.js:826` — `if (chosen !== 'qwen')` guard |
| SC5: No modifications to limit-hit.js, review-loop.js | Verified — only agents.js modified |

## Next action: Run npm test to verify zero regressions, then add regression test for non-limit block behavior
