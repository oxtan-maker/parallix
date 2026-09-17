# CP 4 — Genuine usage-limit / provider-wide outage blocks intact

## Summary
Confirmed the fix preserves all legitimate blocking paths while narrowing only
the ambiguous case:
- Confirmed quota still blocks and reroutes: `detectLimitHit` returns a block for
  `you've hit your weekly limit`, `resource_exhausted`, and `429 … quota`, and
  `startAgent` persists it via `updateAgentBlockFn` (site 1, untouched).
- The qwen transient rate-limit reroute still returns `reroute: true` (no long
  block) — `shouldPersistLaunchFailureBlock` returns `false` for it via
  `!hit.reroute`.
- The SIGINT/SIGKILL short-block path is intact: `detectLimitHit` still classifies
  a process-kill signal; via `startAgent` a kill signal is caught at site 1's
  `detectLimitHit` branch (task-2536 F2). The `shouldPersistLaunchFailureBlock`
  helper unit (`shouldPersistLaunchFailureBlock returns true for signal kills`)
  still passes as a direct classifier test, but is not a live startAgent path.
- The site-2 block-persistence branch (agents.ts L761-L777) is defence-in-depth
  only, unreachable under default wiring — see CP-2.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Confirmed quota still produces expiring block + reroute | `test/limit-hit.test.ts`; `test/agents-limit-hit.test.ts` `startAgent persists a block via updateAgentBlock when limit-hit detector fires` | PASS |
| SIGINT/SIGKILL short-block intact | `detectLimitHit` signal branch in `src/application/services/agent-limit.ts`; via `startAgent` caught at site 1 (`test/limit-hit.test.ts`, `test/agents-limit-hit.test.ts`) | PASS |
| Qwen transient reroute intact | `test/qwen-limit-detection.test.ts` `qwen rate-limit: reroute without long block` | PASS |
| Per-agent reset-time parsing unchanged | `test/limit-hit.test.ts` reset-time tests; `parseResetTime` in `src/application/services/agent-limit.ts` | PASS |

## Next action
CP 5: run the verification gates — `./scripts/verify-local.sh static-analysis`,
`npm test -- --unit-test-headroom`, and `./scripts/verify-local.sh all` — and
record evidence.
