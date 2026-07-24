# CP-3: BoardProjectionBuilder Composition Root Wiring

## Summary

Created `createBoardProjectionBuilder()` in `src/application/projections/create-board-projection-builder.ts` that wires all six concrete read adapters into a single `BoardProjectionBuilder` instance. This is the composition root — the single place where the projection pipeline is assembled.

Added integration-base vs worktree reconciliation tests proving ADR 0051 materialization rules:
- Integration base owns status and assignee; worktree provides newer descriptive content
- `done` + worktree present = unclosed mission (open, not closed)
- `done` + worktree absent + closedAt = closed mission

Wired the projection into the production composition root (`status.ts`) via dynamic imports for CJS rollback compatibility. The `status` command now builds a `BoardProjectionBuilder` and routes mission-specific output (backlog status, checkpoint) through the projection.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `BoardProjectionBuilder.build()` wired in composition root over all six concrete adapters | `src/application/projections/create-board-projection-builder.ts:44`, `"BoardProjectionBuilder is wired in composition root over all six concrete adapters"` | PASS |
| Returns `BoardProjection` with missions from concrete adapter | `src/application/projections/create-board-projection-builder.ts:57`, `"BoardProjectionBuilder.build() returns BoardProjection with missions from concrete adapter"` | PASS |
| Integration-base owns status/assignee, worktree provides newer content (ADR 0051) | `src/adapters/backlog/mission-materialization.ts:70`, `"Integration-base vs worktree reconciliation: base owns status, worktree provides newer content"`, `ADR 0051` | PASS |
| `done` + worktree present = unclosed mission | `src/adapters/backlog/mission-materialization.ts:95`, `"Integration-base vs worktree reconciliation: done + worktree present = unclosed mission"` | PASS |
| `done` + worktree absent + closedAt = closed mission | `src/adapters/backlog/mission-materialization.ts:101`, `"Integration-base vs worktree reconciliation: done + worktree absent + closedAt = closed mission"` | PASS |
| `createBoardProjectionBuilder` wires all six adapters | `src/application/projections/create-board-projection-builder.ts:37-55`, `"createBoardProjectionBuilder wires all six adapters into BoardProjectionBuilder"` | PASS |
| SC8: BoardProjectionBuilder wired at real composition root (status.ts) | `src/platform/runtime/lib/commands/status.ts:10`, `src/platform/runtime/lib/commands/status.ts:117`, `"SC10: status.ts routes mission output through BoardProjectionBuilder (single-path guardrail)"` | PASS |
| SC9: Legacy status routes mission output through projection | `src/platform/runtime/lib/commands/status.ts:186`, `"SC10: status.ts routes mission output through BoardProjectionBuilder (single-path guardrail)"` | PASS |
| SC10: Single-path guardrail test exists | `test/adapters/single-path-guardrail.test.ts`, `"SC10: no module outside the allowed set assembles a board projection"` | PASS |
| SC11: Repository-wins test exists | `test/adapters/repository-wins.test.ts`, `"SC11: ConcreteMissionReadAdapter reads from backlog files (repository authority), not cache"` | PASS |
| SC14: Verification gate passes | `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` `` | PASS |

**Tests:** `npm test -- test/adapters/board-projection-builder-cp3.test.ts` (6 tests, 0 failures), `npm test -- test/adapters/single-path-guardrail.test.ts` (3 tests, 0 failures), `npm test -- test/adapters/repository-wins.test.ts` (7 tests, 0 failures)

Next action: Re-implement the legacy status command board assembly over the projection and add characterization test preserving output contract (CP-4).
