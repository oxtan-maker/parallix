# Mission: Record lifecycle lane-transition events for board metrics (task-2303)

## Goal

Supply the write side for board time-series metrics: a recording path that emits a lane-transition event every time a mission changes status through the `transitionTask` authority. This moves TASK-2281 metrics (median state times, cumulative-flow, throughput, review-loop rate) from "missing-history" fallback to populated values.

## Why Now

TASK-2295 created the generic `operational_history` table with an `append()` API, and TASK-2302 reads it and reports missing-history. Nothing writes lifecycle events, so the metrics layer (`src/application/projections/metrics.ts`) always receives empty transitions and falls through to fallback values. The read side is characterised; the write side is the remaining gap. Without this, the board projections (TASK-2281) and all downstream analytics (TASK-2308 flow-analytics panel) have no data source.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: schema for lane-transition events, typed event interface, recording service, single integration point at transition authority, guardrail test, idempotency test, metrics-fixture test, clean-install and upgrade migration tests

## Scope

- A new forward-only migration creating a dedicated `board_lane_events` table with typed columns (not JSON blobs in `operational_history`), with idempotency guarantees so duplicate emissions do not produce duplicate counts.
- A typed `LaneTransitionEvent` interface defining the event shape (`MissionStatus` types, `trigger`, `idempotencyKey`, `repositoryId`), placed in `src/domain/board-event.ts`.
- A `BoardLaneEventRepository` port and `SqliteBoardLaneEventRepository` implementation with typed columns and proper indexes.
- A `BoardEventRecorder` service with an `append()` method that writes lane-transition events to `board_lane_events` using the typed repository.
- A `MetricsReadAdapter` port and `ConcreteMetricsReadAdapter` that reads `board_lane_events` + `usage_statistics` and produces `BoardMetrics` via `buildMetrics()`.
- Integration of the recorder into the single `transitionTask` authority path (`src/platform/runtime/lib/tools/backlog.ts` → `transitionTaskOnIntegrationBranch`) so every committed transition emits exactly one event (awaited, not fire-and-forget).
- Read-side wiring: `BoardProjectionBuilder` derives metrics from `MetricsReadAdapter` (no longer relying on empty `_options.metrics` fallback).
- Guardrail test that scans the source tree and fails if any module other than the designated write path writes lane-transition events.
- Idempotency test proving duplicate emissions are rejected (no double-counting).
- Operator-local telemetry test proving a replayed event log never overrides repository Git/Markdown lifecycle state and recording failure never blocks the authoritative transition.
- Metrics fixture test: records transitions, reads them through `SqliteBoardLaneEventRepository`, and asserts that `buildMetrics` produces populated (non-fallback) values for cumulative-flow, median-state-times, throughput, and review-loop-rate.
- Clean-install and previous-schema upgrade tests for the new migration, following the existing `SqliteMigrationRunner` pattern.

## Out of Scope

- Changes to the existing `operational_history` table structure.
- Board rendering, TUI, or web UI changes.
- Database cutover of mission state from Markdown/Git to SQLite (ADR 0044 cutover is a separate migration).
- Replay or recovery of mission lifecycle from the event log (events are telemetry only, per ADR 0051).
- Metrics visualization or dashboard components.
- Down-migration of the new schema (forward-only semantics).

## Success Criteria

- SC1: A new migration creates the `board_lane_events` table with typed columns and the `SqliteMigrationRunner` records it with a matching checksum.
- SC2: A guardrail test under `test/` fails the suite if any source file outside the designated write-path module writes lane-transition events or calls the event recorder.
- SC3: The event recorder is called from exactly one location in the `transitionTaskOnIntegrationBranch` path (`src/platform/runtime/lib/tools/backlog.ts`); a test verifies the call exists in that function and no other function in the codebase calls it.
- SC4: A test proves that when recording throws, the `transitionTask` operation completes successfully (event recording failure never blocks the authoritative transition).
- SC5: A test proves that emitting the same transition twice does not produce duplicate rows (idempotency via UNIQUE constraint on `idempotency_key`).
- SC6: A fixture test records at least 3 lane transitions (e.g., backlog→active→review→integration), reads them through `SqliteBoardLaneEventRepository`, constructs `MissionTransition` objects, feeds them to `buildMetrics`, and asserts that `cumulativeFlow` has non-empty series, `medianStateTimes.series` has non-null values, `throughput.series` is non-empty, and `reviewLoopRate.series` has numeric values.
- SC7: A test proves a replayed event log entry never changes the authoritative mission status read from the repository adapter (ADR 0051 "operational truth over UI liveness").
- SC8: `./scripts/verify-local.sh all` passes on the final tree.
- SC9: `./scripts/verify-local.sh static-analysis` passes for all changed `src/` files (ESLint + tsc --checkJs + test-hygiene).
- SC10: Clean-database migration test applies all migrations including the new one and confirms the lane-events schema exists. Previous-schema upgrade test starts from the prior migration state and applies the new migration successfully.
- SC11: `BoardProjectionBuilder.build()` derives metrics from `MetricsReadAdapter` (not empty fallback) when `laneEventRepo` and `usageRepo` are wired into the composition root.

## Risks and Assumptions

- The `transitionTaskOnIntegrationBranch` function is the single authoritative write point for mission lifecycle changes. If other paths write task state (e.g., direct Markdown edits outside this path), the event recorder will miss them — the guardrail test mitigates this.
- The `board_lane_events` table uses typed columns (not JSON blobs). This is a deliberate design choice: JSON blobs in `operational_history` would require parsing on every read, and the sister analytical table `usage_statistics` already uses typed columns.
- The lane-transition events are operator-local telemetry only; they do not participate in the ADR 0044 database cutover authority chain.
- The new migration is forward-only and irreversible; a pre-migration backup is created automatically by `SqliteMigrationRunner.applyMigration()` for irreversible migrations.
- The metrics computation in `src/application/projections/metrics.ts` already accepts `MissionTransition[]`; the recorder must produce events mappable to that type.
- The `transitionTask` function is now async (`Promise<boolean>`) to await lane-event recording. Callers must await the result to ensure the write completes before the CLI exits.

## Checkpoints

- CP 1: Schema and migration — author the new migration for lane-transition events, define the typed event interface, and write the clean-install migration test.
- CP 2: Recording service — implement the recorder's `append()` method writing lane-transition events to `operational_history`, with idempotency test (SC5) and operator-local telemetry test (SC4, SC7).
- CP 3: Single write-point integration — integrate the recorder into `transitionTaskOnIntegrationBranch`, write the guardrail test (SC2, SC3), and verify no other module calls the recorder.
- CP 4: Metrics fixture and upgrade — write the end-to-end fixture test (SC6) recording transitions and asserting populated metric values, plus the previous-schema upgrade test (SC10). Run final verification gates.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/sqlite/migrations/0003-board-events.sql:1` (must point to an existing file and line)
  2. **Test names** — e.g., `"board_events migration creates table with expected columns"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/board-event-recorder.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0051` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `node --test test/board-event-recorder.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Migration creates lane-events schema | File and test name references | PASS |
| Recorder writes lane-transition events to operational_history | File and test name references | PASS |
| Guardrail test detects off-path writers | Test file and name references | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas

- `src/adapters/sqlite/migrations/0001-initial-schema.sql` — do not modify the existing `operational_history` table definition.
- `src/adapters/sqlite/operational-history-repository.ts` — do not add board-event-specific query methods; reuse the existing `findByType()` API.
- `src/platform/runtime/lib/tools/backlog.ts` — modify `transitionTaskOnIntegrationBranch` to add the event-recording call (now awaited). The function signature changed from sync `boolean` to async `Promise<boolean>`.
- `src/application/projections/metrics.ts` — do not modify; the recorder must produce events mappable to the existing `MissionTransition` type without changing this file.
- `src/domain/mission-workflow.ts` — do not modify the `MissionTransition` interface; the recorder maps to its existing shape.
- `lib/` modules other than `lib/tools/backlog.ts` — do not introduce event recording in other command modules.

## Stop Rules

- Stop if `transitionTaskOnIntegrationBranch` is not the single authoritative write point for mission lifecycle changes (investigate other write paths before continuing).
- Stop if adding the event recorder to the transition path requires modifying `transitionTask`'s function signature in a way that affects callers outside this mission's scope (the async migration must be complete at all ~15 call sites).
- Stop if the guardrail test detects more than one existing module already writing to `board_lane_events` with a board-event-like pattern — this indicates an unmodelled write path that must be resolved before proceeding.
- Stop if `buildMetrics` tests fail to produce populated values from recorded events, indicating a type mismatch between the recorder's output and the `MissionTransition` interface.
- Stop if the `BoardProjectionBuilder` does not derive metrics from `MetricsReadAdapter` when the composition root is wired with `laneEventRepo` and `usageRepo`.
