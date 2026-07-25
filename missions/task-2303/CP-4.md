# CP-4: Metrics fixture and upgrade

## Summary of work done

Wrote the end-to-end metrics fixture test (SC6) recording transitions and
asserting populated metric values, plus the previous-schema upgrade test (SC10)
and SC7 telemetry tests. Ran final verification gates.

- **`test/board-event-metrics-fixture.test.ts`** — SC6 fixture test recording
  3 lane transitions (backlog→active→review→done) through the `BoardEventRecorder`,
  reading them back through `SqliteOperationalHistoryRepository.findByType()`,
  constructing `MissionTransition` objects via `laneTransitionEventToMissionTransition()`,
  and feeding them to `buildMetrics()`. Asserts that `cumulativeFlow.series` is
  non-empty with positive values, `medianStateTimes.series` has non-null values,
  `throughput.series` is non-empty, and `reviewLoopRate.series` has numeric values.
  Additional test verifies multiple missions produce correct cumulative flow counts.
  Third test confirms missing-history fallbacks convert to populated values when
  events exist. SC7 tests prove the replayed event log never overrides repository
  Git/Markdown lifecycle state (ADR 0051) — the event log is read-only telemetry
  independent of the authoritative Markdown status.
- **`test/board-lane-events-migration.test.ts`** — added SC10 previous-schema
  upgrade test starting from the 0001+0002 state (prior migration), applying the
  0003 migration, and verifying indexes are created and the lane-transition schema
  works correctly after upgrade.
- **Verification gates** — `./scripts/verify-local.sh all` passes 1231 tests /
  0 failures. `./scripts/verify-local.sh static-analysis` reports one pre-existing
  typecheck error in `src/platform/runtime/lib/commands/status.ts:203` (not
  introduced by this mission).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: migration creates the lane-events schema, runner records it with matching checksum | `src/adapters/sqlite/migrations/0003-board-lane-events.sql:22`; test `"clean install applies all migrations and creates the lane-events indexes"` in `test/board-lane-events-migration.test.ts` | PASS |
| SC2: guardrail test fails if any source file outside the write-path writes lane-transition events | `test/board-event-guardrail.test.ts` — `"SC2: only the designated write-path module imports BoardEventRecorder outside the recorder package"` and `"SC2: no source file writes lane-transition events outside backlog.ts"` | PASS |
| SC3: recorder called from exactly one location in `transitionTaskOnIntegrationBranch` | `src/platform/runtime/lib/tools/backlog.ts:695`; test `"SC3: transitionTaskOnIntegrationBranch contains the recorder call and is the single call site"` in `test/board-event-guardrail.test.ts` | PASS |
| SC4: recording failure never blocks the authoritative transition | `src/application/recording/board-event-recorder.ts:57` — `recordLaneTransitionSafely`; `src/platform/runtime/lib/tools/backlog.ts:702` — fire-and-forget `Promise.resolve(...).catch(() => {})`; test `"swallows a recorder failure and returns false instead of throwing"` in `test/board-event-recorder.test.ts` | PASS |
| SC5: duplicate emissions do not produce duplicate rows (idempotency) | `src/application/recording/board-event-recorder.ts:38` — application-level dedup; `src/adapters/sqlite/migrations/0003-board-lane-events.sql:23` — storage-layer UNIQUE index; test `"SC5: emitting the same operation id twice does not produce a duplicate row"` in `test/board-event-recorder.test.ts` | PASS |
| SC6: fixture records transitions, reads back, asserts populated metric values | `test/board-event-metrics-fixture.test.ts` — `"records 3 lane transitions (backlog->active->review->done) and produces non-empty metrics"` asserts cumulativeFlow, medianStateTimes, throughput, reviewLoopRate all populated | PASS |
| SC7: replayed event log never changes authoritative mission status | `test/board-event-metrics-fixture.test.ts` — `"event log entries are read-only telemetry; they do not affect mission status resolution"` and `"event log survives independently of mission Markdown state changes"`; `ADR 0051` | PASS |
| SC8: `./scripts/verify-local.sh all` passes | `./scripts/verify-local.sh all` — 1231 pass / 0 fail | PASS |
| SC9: `./scripts/verify-local.sh static-analysis` passes for changed `src/` files | `./scripts/verify-local.sh static-analysis` — ESLint clean; tsc has 1 pre-existing error in `src/platform/runtime/lib/commands/status.ts:203` (not from this mission) | PASS |
| SC10: clean-install migration test | test `"clean install applies all migrations and creates the lane-events indexes"` in `test/board-lane-events-migration.test.ts` | PASS |
| SC10: previous-schema upgrade test | test `"SC10: previous-schema upgrade applies 0003 migration from prior state"` in `test/board-lane-events-migration.test.ts` | PASS |
| Restricted Areas: `operational_history` table definition unchanged | `src/adapters/sqlite/migrations/0001-initial-schema.sql:73` — CREATE TABLE operational_history unchanged | PASS |
| Restricted Areas: `operational-history-repository.ts` unchanged | `src/adapters/sqlite/operational-history-repository.ts:38` — `findByType` API reused, no new methods added | PASS |
| Restricted Areas: `metrics.ts` not modified | `src/application/projections/metrics.ts:206` — `buildMetrics` signature unchanged | PASS |
| Restricted Areas: `mission-workflow.ts` not modified | `src/domain/mission-workflow.ts:33` — `MissionTransition` interface unchanged | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` | PASS |

## Gates

- [x] `./scripts/verify-local.sh all` — 1231 pass / 0 fail
- [x] `./scripts/verify-local.sh static-analysis` — ESLint clean, tsc has 1 pre-existing error (status.ts:203, not from this mission)

## Next action

Mission complete. All checkpoints delivered, all success criteria verified, all gates passed.
