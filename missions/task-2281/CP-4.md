# CP-4: Guarded command controller, progress events, and final verification

## Summary

Finalized the guarded command controller with progress-event ordering tests, stale-command rejection verification, and cooperative cancellation. Verified all mission-declared gates pass. ESLint clean for all new source and test files under `src/application/`.

### Files created/modified

- **`test/board-progress-events.test.ts`** — 10 tests covering SC6 (progress-event sequence ordering, stable operationId, ISO timestamps, agent name propagation), SC6 cancellation at safe boundaries (pre-launch and post-record), and SC7 stale-command rejection with `conflict` error kind.
- **ESLint fixes** across all new files: unused import removal, underscore-prefixed unused parameters in interfaces and test mocks.

### Verification

- All 1146 tests pass (`./scripts/verify-local.sh all`)
- ESLint clean for `src/application/` and all new test files (`npx eslint src/application/ test/board-*.test.ts`)
- Typecheck clean (`npm run typecheck`, only pre-existing error in `integrate.ts`)
- Pre-existing ESLint error in `src/platform/runtime/lib/commands/integrate.ts:1954` (`buildBeforeVerification` not defined) is not from this mission

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: BoardProjection type with version field in `src/application/projections/` | `src/application/projections/board.ts:18` (`BOARD_PROJECTION_VERSION`), `board.ts:57` (`BoardProjection` interface), `test/board-projections.test.ts` test: `"BoardProjection has version field and all required shape members"` | PASS |
| SC2: attentionRank deterministic with 5 tiers + missionId tie-breaker | `src/application/projections/mission-board.ts:103` (`attentionRank`), `test/board-projections.test.ts` tests: `"attentionRank returns 0 for blocking reason present"`, `"attentionRank returns 1 for gate failed"`, `"attentionRank returns 2 for review lane"`, `"attentionRank returns 3 for integrate lane"`, `"attentionRank returns 4 for all others"`, `"attentionQueue tie-breaker: same rank sorted by missionId ascending"`; `test/board-readers.test.ts` tests: `"attention ranking tie-breaker: proximity to completion"`, `"attention ranking tie-breaker: severity within same lane"` | PASS |
| SC3: Cumulative-flow, median state times, throughput, review-loop rate each declare missingHistoryFallback | `src/application/projections/metrics.ts:119` (`cumulativeFlowSeries`, `missingHistoryFallback: 'estimate'`), `metrics.ts:82` (`medianStateTimes`, `missingHistoryFallback: 'null'`), `metrics.ts:139` (`throughputSeries`, `missingHistoryFallback: 'skip'`), `metrics.ts:163` (`reviewLoopRateSeries`, `missingHistoryFallback: 'estimate'`); `test/board-metrics.test.ts` — 5 dedicated fallback tests | PASS |
| SC4: Guarded controller exposes active:execute, rejects others with `rejected` + `kind: 'capability'` | `src/application/controller/board-command.ts:79` (`INTEGRATED_CAPABILITIES`), `src/application/controller/board-controller.ts:45` (capability guard), `test/board-controller.test.ts` tests: `"controller dispatches active:execute through ActiveService"`, `"controller rejects draft:create with capability kind"` (and 5 more unavailable commands) | PASS |
| SC5: Available actions are capability results `{ command, enabled, reason }`; no UI imports | `src/application/projections/mission-board.ts:31` (`CommandAvailability`), `test/board-controller.test.ts` test: `"controller does not import ink, react, or node:react"`; `test/board-no-bypass.test.ts` test: `"board controller and projections do not import forbidden dependencies"` | PASS |
| SC6: Progress events carry stable operationId; cancellation produces `cancelled` outcome; post-boundary cancellation returns durable partial state | `src/application/controller/board-command.ts:62` (`OperationEvent`), `test/board-progress-events.test.ts` tests: `"progress events share stable operationId across all phases"`, `"cancellation before any port call returns cancelled with no evidence"`, `"cancellation after durable record returns partial evidence without rollback"` | PASS |
| SC7: Stale commands return `status: 'failed'` + `error.kind: 'conflict'` | `src/application/controller/board-command.ts:58` (`staleConflict`), `src/application/controller/board-controller.ts:82` (`dispatchWithStatus`), `test/board-progress-events.test.ts` tests: `"stale command returns failed status with conflict error kind"`, `"stale check happens before capability dispatch"` | PASS |
| SC8: Projection rebuild returns fresh/stale SourceFact | `src/application/projections/board-readers.ts:169` (`checkProjectionStaleness`), `test/board-readers.test.ts` tests: `"checkProjectionStaleness returns fresh when Git HEAD matches"`, `"checkProjectionStaleness returns stale when Git HEAD differs"`, `"checkProjectionStaleness returns stale when no cached HEAD"` | PASS |
| SC9: Unit tests cover every projection stage, attention reason, metric fallback, stale command, invalid transition, progress-event ordering — all mocked | `test/board-projections.test.ts` (26 tests), `test/board-controller.test.ts` (17 tests), `test/board-no-bypass.test.ts` (5 tests), `test/board-readers.test.ts` (12 tests), `test/board-metrics.test.ts` (22 tests), `test/board-progress-events.test.ts` (10 tests) — 92 total new tests, all without real subprocesses | PASS |
| SC10: `./scripts/verify-local.sh all` passes; ESLint + tsc --checkJs clean for new files | `./scripts/verify-local.sh all` — 1146 tests pass; `npx eslint src/application/` — clean; `npm run typecheck` — clean (only pre-existing `integrate.ts` error) | PASS |
| SC11: No-bypass test fails on forbidden imports | `test/board-no-bypass.test.ts` tests: `"board controller and projections do not import forbidden dependencies"`, `"board controller does not import any legacy command handler"`, `"board controller does not implement lifecycle transitions not owned by integrated use case"`, `"board controller uses ActiveService for active:execute dispatch"` | PASS |
| ADR 0051 dependency direction | `docs/adr/0051-ui-neutral-application-boundary.md`, verified by `test/board-no-bypass.test.ts` (forbidden: `ink`, `react`, `node:fs`, `node:child_process`, `process.exit`, legacy `lib/commands/`) | PASS |

### Gates

| Gate | Command | Result |
|---|---|---|
| All tests | `./scripts/verify-local.sh all` | PASS (1146 tests) |
| ESLint (new files) | `npx eslint src/application/` | PASS |
| Typecheck | `npm run typecheck` | PASS (pre-existing `integrate.ts` error only) |

Next action: Mission complete — all checkpoints delivered, all gates pass, commit all checkpoint documents and hand off to Parallix lifecycle.
