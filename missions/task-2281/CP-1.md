# CP-1: Versioned projection types and guarded command controller types

## Summary

Defined the versioned board projection types (`BoardProjection` with `version` field), guarded command controller types (`BoardCommandRequest`, `BoardCommandResult`, `OperationEvent`), and the `BoardCommandController` that dispatches only integrated capabilities.

### Files created/modified

- **`src/application/projections/board.ts`** — `BoardProjection` type with `version` field, `BoardStage`, `AttentionReason`, `MetricSeries`, `BoardMetrics`, `WipCountMetric`, `OperationLogEntry`, `AttentionItem`. Builder functions: `buildBoardProjection`, `buildBoardStage`, `buildBoardMetrics`, `attentionReason`.
- **`src/application/controller/board-command.ts`** — `BoardCommandKind` union type (7 lifecycle commands), `BoardCommandRequest`, `BoardCommandResult`, `BoardCancellation`, `OperationEvent`. Capability registries: `INTEGRATED_CAPABILITIES` (only `active:execute`), `UNAVAILABLE_CAPABILITIES` (6 unextracted commands with documented reasons). Helper functions: `isIntegratedCapability`, `unavailableReason`, `unavailableCapability`, `staleConflict`, `cancelledOutcome`.
- **`src/application/controller/board-controller.ts`** — `BoardCommandController` class with guarded `dispatch()` and `dispatchWithStatus()` methods. Capability check → stale check → cancellation check → delegate to `ActiveService`. Progress event emission through `ProgressPort`.
- **`test/board-projections.test.ts`** — 26 tests covering SC1 (BoardProjection shape), SC2 (all 5 attentionRank tiers + tie-breaker), BoardLane mappings for all 6 statuses, BoardMetrics fallback properties, buildBoardProjection integration.
- **`test/board-controller.test.ts`** — 17 tests covering SC4 (active:execute dispatch + 6 unavailable rejections), SC5 (no UI imports), SC6 (stable operationId, monotonic sequence, cancellation), SC7 (stale command rejection).
- **`test/board-no-bypass.test.ts`** — 5 tests covering SC11 (forbidden imports, no legacy handlers, no unowned lifecycle transitions, ActiveService delegation).

### Verification

- All 1107 tests pass (`npm test`)
- Types compile cleanly (`npm run typecheck`, only pre-existing error in `integrate.ts`)
- ADR 0051 dependency direction verified: no `ink`, `react`, `node:fs`, `node:child_process`, `process.exit`, or legacy command handler imports in controller/projection modules

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: BoardProjection type with version field in `src/application/projections/` | `src/application/projections/board.ts:18` (`BOARD_PROJECTION_VERSION`), `board.ts:68` (`BoardProjection` interface with `version`, `repositoryId`, `stages`, `attentionQueue`, `wipCounts`, `availableActions`, `operationLog`, `metrics`, `sourceFacts`) | PASS |
| SC2: attentionRank deterministic with 5 tiers + tie-breaker | `src/application/projections/mission-board.ts:103` (`attentionRank`), `test/board-projections.test.ts` tests: `"attentionRank returns 0 for blocking reason present"`, `"attentionRank returns 1 for gate failed"`, `"attentionRank returns 2 for review lane"`, `"attentionRank returns 3 for integrate lane"`, `"attentionRank returns 4 for all others"`, `"attentionQueue tie-breaker: same rank sorted by missionId ascending"` | PASS |
| SC3: MetricSeries declares missingHistoryFallback | `src/application/projections/board.ts:38` (`MetricSeries` interface with `missingHistoryFallback: 'null' \| 'estimate' \| 'skip'`), `test/board-projections.test.ts` test: `"BoardMetrics has all four metric series with missingHistoryFallback"` | PASS |
| SC4: Guarded controller exposes active:execute, rejects others with capability kind | `src/application/controller/board-command.ts:79` (`INTEGRATED_CAPABILITIES`), `src/application/controller/board-controller.ts:46` (capability guard), `test/board-controller.test.ts` tests: `"controller dispatches active:execute through ActiveService"`, `"controller rejects draft:create with capability kind"` (and 5 more) | PASS |
| SC5: Available actions are capability results; no UI imports | `src/application/projections/mission-board.ts:31` (`CommandAvailability` with `{ command, enabled, reason }`), `test/board-controller.test.ts` test: `"controller does not import ink, react, or node:react"`, `test/board-no-bypass.test.ts` test: `"board controller and projections do not import forbidden dependencies"` | PASS |
| SC6: Progress events with stable operationId; cancellation produces cancelled outcome | `src/application/controller/board-command.ts:62` (`OperationEvent`), `src/application/controller/board-controller.ts:89` (`emit`), `test/board-controller.test.ts` tests: `"progress events carry stable operationId"`, `"progress events have monotonically increasing sequence numbers"`, `"cancellation before launch returns cancelled outcome"`, `"controller passes cancellation to ActiveService for post-boundary cancellation"` | PASS |
| SC7: Stale commands return conflict kind | `src/application/controller/board-command.ts:58` (`staleConflict`), `src/application/controller/board-controller.ts:82` (`dispatchWithStatus`), `test/board-controller.test.ts` tests: `"dispatchWithStatus rejects stale command with conflict kind"`, `"dispatchWithStatus proceeds when status matches"` | PASS |
| SC11: No-bypass test fails on forbidden imports | `test/board-no-bypass.test.ts` tests: `"board controller and projections do not import forbidden dependencies"`, `"board controller does not import any legacy command handler"`, `"board controller does not implement lifecycle transitions not owned by integrated use case"`, `"board controller uses ActiveService for active:execute dispatch"` | PASS |
| ADR 0051 dependency direction | `docs/adr/0051-ui-neutral-application-boundary.md`, verified by `test/board-no-bypass.test.ts` (forbidden imports: `ink`, `react`, `node:fs`, `node:child_process`, `process.exit`, legacy `lib/commands/`) | PASS |
| Verification gate | `npm test` — 1107 tests pass; `npm run typecheck` — clean (only pre-existing `integrate.ts` error) | PASS |

Next action: CP-2 — Build read adapters over task, mission, review, gate, agent, and Git authorities; implement deterministic attention ranking with tie-breaker tests and verify attentionQueue ordering across all 5 tiers.
