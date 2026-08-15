## Summary

Fixed `startAgent` in `src/adapters/agents/agents.ts` to try excluded agents as last-resort fallback when the non-excluded agent pool exhausts.

Change: in the pool-exhaustion catch block, before throwing "All eligible agents exhausted", scan the original `exclude` list for an agent not yet launched. If found, set it as `chosen` and continue the loop. If no excluded agent is available (all already tried), throw as before.

This restores the documented single-family escape hatch: when no different-family reviewer is available, the implementer reviews its own work. Matches the pattern in `review-agent-fallback.ts` single-family-fallback.

Existing behavior unchanged: excluded agents are NOT tried when a non-excluded agent succeeds (SC4). Only triggers on pool exhaustion.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: startAgent tries excluded agents on exhaustion | `test/task-2377-repro.test.ts`, `"startAgent tries excluded agents after non-excluded pool exhausts"` | PASS |
| SC2: Implementer tried when all others fail | `test/task-2377-repro.test.ts`, `"startAgent tries excluded agents after non-excluded pool exhausts"` — excluded `claude` selected | PASS |
| SC3: Exhaustion error only after all tried | `test/task-2377-repro.test.ts`, `"startAgent throws exhaustion after both non-excluded and excluded agents fail"` | PASS |
| SC4: Excluded agents NOT tried on success | `test/task-2377-repro.test.ts`, `"startAgent does not try excluded agents when non-excluded agent succeeds"` | PASS |
| SC6: Repro test red-to-green | `npx tsx --test test/task-2377-repro.test.ts` — 2 fail before fix, 3 pass after | PASS |
| SC7: Static analysis clean | `./scripts/verify-local.sh static-analysis` — all 4 stages pass | PASS |
| No regression in existing tests | `npx tsx --test test/task-1036-review-fallback.test.ts test/task-2335-reviewer-family-repro.test.ts` — 15/15 pass | PASS |
| Gate: static-analysis | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Mission complete — all checkpoints committed, all gates pass. Ready for `px checkpoint`.
