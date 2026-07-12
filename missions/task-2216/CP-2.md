# CP-2 — Shared custom capacity guard

## Summary of work done

Implemented a process-local custom-agent capacity manager with an idempotent reservation release. The maximum is resolved from `adapters.agents.maxConcurrentCustom`, defaults to `1`, and invalid values are rejected by configuration validation. `startAgent` now acquires immediately before invoking a custom launcher and releases in `finally`, covering clean completion, failed launch results, cancellation signals, and rejected launcher promises. A failed acquisition causes the normal selection/retry path to choose another family instead of starting a custom process.

Focused tests prove the default/configured value and invalid-value rejection, saturation fallback/no-alternative behavior, and release followed by exactly one new acquisition for clean, failure, signal, and rejected-promise terminal paths.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Configured maximum has a default and rejects invalid values | `lib/core/product-config.ts:22`, `lib/core/product-config.ts:130`, `"resolveMaxConcurrentCustom defaults to one and reads a positive configured limit"`, `"validateWorkflowConfig rejects invalid maxConcurrentCustom values"` | PASS |
| Shared guard prevents launch beyond capacity and permits one replacement after release | `lib/agents/custom-capacity.ts:12`, `lib/agents/custom-capacity.ts:16`, `test/agents.test.js:102` | PASS |
| Launch guard is owned by the shared lifecycle and releases on terminal paths | `lib/agents/agents.ts:330`, `lib/agents/agents.ts:342`, `lib/agents/agents.ts:383`, `"custom capacity releases after clean completion, launch failure, signal cancellation, and rejected runtime result"` | PASS |
| Capacity reset/recovery operation is available and idempotent | `lib/agents/custom-capacity.ts:21`, `lib/agents/custom-capacity.ts:31`, `test/agents.test.js:62` | PASS |
| Focused configuration and lifecycle tests pass | `npm run build:cjs && node --test test/product-config.test.js test/agents.test.js` | PASS |

Next action: Complete selector/documentation verification, update the repository graph, and run the mission’s full `all` gate before recording the final evidence.
