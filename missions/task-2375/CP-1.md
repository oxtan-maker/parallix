# CP-1: Red regression reproduction for bounded current-work read

## Summary

Reproduction test at `test/task-2375-current-work-operation-repro.test.ts` already existed in red state. Root cause: `ConcreteCurrentWorkReadAdapter.loadCurrentWork()` used `findLatestByTypePerMission(CURRENT_WORK_EVENT_TYPE, 2)` — only 2 latest events per mission. With the sequence `op-A running → op-B running → op-A ended → op-A blocked`, only `op-A ended` and `op-A blocked` survived the bounded window; `op-B running` was discarded before reaching the reconciler.

Fix: `ConcreteCurrentWorkReadAdapter` now uses `findByType(CURRENT_WORK_EVENT_TYPE)` (all events). The reconciler already reduces to one standing fact per mission — the fixed N-latest window was the bottleneck, not the reconciliation logic.

Additional fixes applied in same pass (spanning all checkpoints):
- `operationId` uniqueness: review (`review:${slug}:${uuid()}`), integrate (`integrate:${slug}:${uuid()}`), and execute/`px active` (`active:${slug}:${uuid()}`) now carry per-invocation UUIDs
- Metrics cache key: stripped volatile `agentAvailability` (carries `blockedForMs`) from cache key; cache hit swaps in fresh agent availability
- Non-Linux liveness: `probeProcessLiveness` returns `null` (unverifiable) when recorded identity is `null`, so TTL aging applies instead of permanent `live`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Operation B survives late op-A terminal events | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC1: the production current-work read keeps operation B standing after late op-A terminal events"` | PASS |
| SC1: Unbounded late events from older ops | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC1: op-B survives an unbounded number of late terminal events from older operations"` | PASS |
| SC1: Standing op cleared by own terminal event | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC1: the standing operation is still cleared by its own terminal event"` | PASS |
| SC2: Unique operationId per invocation | `src/application/review-command-use-case.ts` (randomUUID), `src/application/integrate-command-use-case.ts` (randomUUID), `src/adapters/cli/commands/active.ts` (randomUUID) | PASS |
| SC4: Metrics cache key excludes volatile agentAvailability | `src/application/projections/board-readers.ts` buildMetrics cache key | PASS |
| SC5: Non-Linux liveness ages out via TTL | `src/adapters/process/process-liveness.ts` probeProcessLiveness returns null for null identity | PASS |
| Static analysis gate | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

Next action: CP-2 — add production-path overlap test (two same-type invocations on one mission) and verify nested publication and eligible-family failover remain correct.
