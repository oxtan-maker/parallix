# CP-3: Rationale Comment and Enhanced Log Message

## Summary

1. Added a rationale comment above `shouldPersistLaunchFailureBlock` at `lib/agents/agents.ts:174-178` explaining that deterministic config/setup errors must not poison the persistent blocklist — only transient failures deserve a block.

2. Enhanced the block-persistence log message at `lib/agents/agents.ts:924` to include a reason label derived from the failure classification:
   - Signal kills → `"signal SIGKILL"` etc.
   - Spawn errors → `"ENOENT"`, `"EACCES"` etc.
   - Non-zero exit codes → `"exit 1"` etc.
   - Default → `"transient crash"`

The log line now reads:
```
Wrote blocklist entry for codex -> /path/agents.local.json (1h block, signal SIGKILL)
```

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Rationale comment on shouldPersistLaunchFailureBlock | `lib/agents/agents.ts:174-178` | Done |
| Enhanced log message with reason label | `lib/agents/agents.ts:924`, includes `${blockReason}` | Done |
| All tests still pass | `node --test test/agents-limit-hit.test.js` — 22 pass, 0 fail | Pass |

## Next action

Run `./scripts/verify-local.sh all` to confirm clean static analysis and integration gates (CP-4).
