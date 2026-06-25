# CP-1: Root Cause Confirmation

## Work Done

Examined the following code paths to confirm the root cause described in the mission:

### 1. `startAgent` only blocks on `detectLimitHit` truthy (agents.js:762)

At `lib/agents/agents.js:762-782`, the blocklist update is gated behind `if (limitHit)`:
```javascript
if (limitHit) {
  log(fmt.status('WARN', `Limit hit detected for ${fmt.agent(chosen)}...`));
  try {
    const blockResult = updateAgentBlockFn(chosen, limitHit.until);
    ...
  } catch (err) { ... }
  ...
  chosen = null;
  continue;
}
```

### 2. `launchFailed` retries without blocking (agents.js:806-824)

At `lib/agents/agents.js:806-824`, the `launchFailed` branch logs a warning, records error details, adds the agent to `tried`, and continues — but **never calls `updateAgentBlockFn`**:
```javascript
if (launchFailed) {
  log(fmt.status('WARN', `Agent ${fmt.agent(chosen)} failed to complete...`));
  agentErrors.set(chosen, {...});
  tried.add(chosen);
  launched.add(chosen);
  chosen = null;
  continue;
}
```

### 3. `selectAgent` throws when all agents are unblocked but failed (agents.js:401)

At `lib/agents/agents.js:401-404`, when the pool is empty (all agents in `excluded`/`tried`), `selectAgent` throws:
```javascript
throw new Error(
  `All eligible agents for step "${step}" are exhausted (limit-hit or excluded). ` +
  `Tried: ${[...excluded].join(', ')}.`
);
```

Since non-limit failures don't call `updateAgentBlockFn`, the agent isn't written to the blocklist. And since the agent is only in `tried` (not permanently blocked), the next `selectAgent` call sees it as eligible again — leading to infinite retry or eventual exhaustion.

### 4. `updateAgentBlock` signature (agents.js:476)

Takes `(agent, until, options)` where `until` is a formatted `"YYYY-MM-DD HH"` string.

### 5. `DEFAULT_FALLBACK_HOURS = 1` (limit-hit.js:3)

Available for use as the default block duration for non-limit failures.

## Root Cause Confirmed

The `launchFailed` branch at agents.js:806 does not call `updateAgentBlockFn` for non-limit failures. Only the `detectLimitHit` branch at agents.js:762 does. This means agents failing with API key errors, model-not-found, etc. are retried but not blocked, causing `selectAgent` to throw "All eligible agents exhausted" instead of allowing the review-loop fallback path to activate.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `startAgent` blocks only on `detectLimitHit` truthy | `lib/agents/agents.js:762` — `if (limitHit) { updateAgentBlockFn(...) }` |
| `launchFailed` retries without blocking | `lib/agents/agents.js:806-824` — no `updateAgentBlockFn` call |
| `selectAgent` throws when all exhausted | `lib/agents/agents.js:401-404` — `All eligible agents for step "${step}" are exhausted` |
| `DEFAULT_FALLBACK_HOURS` available | `lib/agents/limit-hit.js:3` — `const DEFAULT_FALLBACK_HOURS = 1` |
| `qwen` is opencode agent | `lib/agents/agents.js:33` — `qwen: startOpencodeAgent` |

## Next action: Implement CP-2 — Add updateAgentBlockFn call in launchFailed branch with qwen exclusion, importing formatBlockUntil and DEFAULT_FALLBACK_HOURS from limit-hit.js
