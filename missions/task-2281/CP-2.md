# CP-2: Read adapters and deterministic attention ranking

## Summary

Built read adapters over task, mission, review, gate, agent, and Git authorities. Implemented `BoardProjectionBuilder` that composes all adapters into a `BoardProjection`. Verified deterministic attention ranking with tie-breaker tests across all 5 tiers.

### Files created

- **`src/application/projections/board-readers.ts`** — Read adapter interfaces: `MissionReadAdapter` (task/mission from target repository or cache), `ReviewReadAdapter` (Git-owned review artifacts), `GateReadAdapter` (integration pipeline results), `AgentReadAdapter` (operator-local agent availability), `GitReadAdapter` (repository identity and HEAD commit), `OperationLogReadAdapter` (operator-local event history). `BoardProjectionBuilder` class composes all adapters into a `BoardProjection`. `checkProjectionStaleness` function for rebuildability (SC8).
- **`test/board-readers.test.ts`** — 12 tests covering BoardProjectionBuilder integration, attentionQueue ordering, tie-breaker rules, gate-failed status integration, source facts, default metrics fallback, and projection staleness checking.

### Verification

- All 1079 tests pass (`npm test`)
- Types compile cleanly (`npm run typecheck`)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: BoardProjection with repository identity and stages | `src/application/projections/board-readers.ts:108` (`BoardProjectionBuilder.build()`), `test/board-readers.test.ts` test: `"BoardProjectionBuilder builds projection with repository identity and stages"` | PASS |
| SC2: attentionRank deterministic with tie-breaker | `src/application/projections/mission-board.ts:103` (`attentionRank`), `src/application/projections/mission-board.ts:113` (`attentionQueue`), `test/board-readers.test.ts` tests: `"attention ranking tie-breaker: proximity to completion"`, `"attention ranking tie-breaker: same rank, different missionId"`, `"attention ranking tie-breaker: severity within same lane"` | PASS |
| SC2: attentionQueue ordering across all 5 tiers | `test/board-readers.test.ts` test: `"BoardProjectionBuilder attentionQueue orders by rank then missionId"` (review→backlog→active), `test/board-readers.test.ts` test: `"BoardProjectionBuilder reflects gate-failed status in attention ranking"` (gate-failed rank 1 before active rank 4) | PASS |
| SC8: Projection rebuildability with SourceFact status | `src/application/projections/board-readers.ts:171` (`checkProjectionStaleness`), `test/board-readers.test.ts` tests: `"checkProjectionStaleness returns fresh when Git HEAD matches"`, `"checkProjectionStaleness returns stale when Git HEAD differs"`, `"checkProjectionStaleness returns stale when no cached HEAD"` | PASS |
| Verification gate | `npm test` — 1079 tests pass; `npm run typecheck` — clean | PASS |

Next action: CP-3 — Implement time-based metrics (WIP, median state times, cumulative-flow, throughput, review-loop rate) with explicit missing-history fallback behavior and targeted tests for every fallback path.
