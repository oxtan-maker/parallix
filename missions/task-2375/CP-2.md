# CP-2: Bounded current-work reconciliation and invocation correlation

## Summary

**Bounded read fix**: `ConcreteCurrentWorkReadAdapter` switched from `findLatestByTypePerMission(type, 2)` to `findByType(type)`. The reconciler already reduces events to one standing fact per mission using operation-aware correlation — the fixed N-latest window was the bottleneck that discarded still-running operations when older operations emitted late terminal events.

**operationId uniqueness**: Review, integrate, and execute use cases now generate per-invocation unique IDs using `crypto.randomUUID()`:
- `review:${slug}:${uuid()}` in `ReviewCommandUseCase`
- `integrate:${slug}:${uuid()}` in `IntegrateCommandUseCase`
- `active:${slug}:${uuid()}` in the `px active` command (`src/adapters/cli/commands/active.ts`)

**Overlap tests**: Added production-path tests proving two same-type invocations on one mission cannot cross-terminate, and nested phases retain the same operationId.

**Existing tests updated**:
- `task-2373-repro.test.ts` defect 5: test updated to reflect unbounded reads (correctness over bounded cost)
- `task-2373-liveness.test.ts` SC13: test updated for new null-return semantics

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Operation B survives late op-A events | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC1: the production current-work read keeps operation B standing after late op-A terminal events"` | PASS |
| SC1: Unbounded late events | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC1: op-B survives an unbounded number of late terminal events from older operations"` | PASS |
| SC2: Distinct operationId per invocation | `src/application/review-command-use-case.ts` (randomUUID), `src/application/integrate-command-use-case.ts` (randomUUID), `src/adapters/cli/commands/active.ts` (randomUUID) | PASS |
| SC2: Real px active wiring assigns unique operationIds | `test/task-2375-active-invocation-overlap.test.ts`, `"TASK-2375 SC2: the real px active command assigns a unique per-invocation operationId"` | PASS |
| SC2: Overlapping real px active runs cannot cross-terminate | `test/task-2375-active-invocation-overlap.test.ts`, `"TASK-2375 SC2: two overlapping real px active runs cannot cross-terminate each other"` | PASS |
| SC2: Same-type overlap cannot cross-terminate | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC2: two overlapping same-type invocations on one mission have distinct operationId and cannot cross-terminate"` | PASS |
| SC2: Blocked from older op does not replace newer | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC2: blocked event from older invocation does not replace newer running work"` | PASS |
| SC2: Nested phases retain same operationId | `test/task-2375-current-work-operation-repro.test.ts`, `"TASK-2375 SC2: nested phases retain the same operationId"` | PASS |
| SC6: Eligible-family failover unchanged | `test/domain-agent-selection.test.ts` (9 tests), `test/task-1036-review-fallback.test.ts` (4 tests) — all PASS | PASS |
| Existing shutdown tests green | `test/task-2373-shutdown.test.ts` (9/9 PASS) | PASS |
| Static analysis gate | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

Next action: CP-3 — write metrics-cache and liveness checkpoint document with Goal Check evidence.
