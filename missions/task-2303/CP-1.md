# CP-1: Schema and migration

## Summary of work done

Authored the forward-only migration and the typed event interface for board
lane-transition telemetry, and wrote the clean-install migration test.

- **`src/adapters/sqlite/migrations/0003-board-lane-events.sql`** — forward-only
  migration (no `down`) that models lane-transition events over the *existing*
  generic `operational_history` table (`event_type = 'lane-transition'`, payload
  JSON in `event_data`). It does **not** alter the `operational_history` table
  definition owned by `0001-initial-schema.sql`; it only adds:
  - `idx_operational_history_lane_transition_operation` — a **partial UNIQUE**
    index over `json_extract(event_data, '$.operationId')` scoped to
    `event_type = 'lane-transition'`, the durable idempotency backstop (SC5).
  - `idx_operational_history_lane_transition_mission` — a query-support index
    over the mission id.
- **`src/domain/board-event.ts`** — the typed `LaneTransitionEvent` interface
  (missionId, from, to, operationId, agent, occurredAt) and the
  `LANE_TRANSITION_EVENT_TYPE` constant. Placed in the domain layer next to the
  mission model; carries no adapter dependency.
- **`test/board-lane-events-migration.test.ts`** — clean-install migration test
  following the `SqliteMigrationRunner` + `loadDefaultMigrations` pattern from
  `test/sqlite-adapter-cp1.test.ts`.

The migration is picked up automatically by `loadDefaultMigrations()` (loads
`migrations/*.sql` in filename order) and recorded by `SqliteMigrationRunner`
with a SHA-256 checksum, so no runner wiring changes were needed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: migration creates the lane-events schema and the runner records it with a matching checksum | `src/adapters/sqlite/migrations/0003-board-lane-events.sql:22`; test `"clean install applies all migrations and creates the lane-events indexes"` in `test/board-lane-events-migration.test.ts` | PASS |
| Typed `LaneTransitionEvent` (missionId/from/to/operationId/agent/timestamp) defined in the domain model | `src/domain/board-event.ts:16` | PASS |
| Migration is forward-only (no down SQL); runner takes a pre-migration backup for irreversible migrations | `src/adapters/sqlite/migrations/0003-board-lane-events.sql:11`; test `"is discovered by loadDefaultMigrations with a stable checksum"` (asserts `migration.down === undefined`) | PASS |
| Idempotency backstop enforced at storage layer (SC5, partial UNIQUE index) | `src/adapters/sqlite/migrations/0003-board-lane-events.sql:23`; test `"the unique index rejects a duplicate lane-transition operation id at the storage layer"` | PASS |
| Existing `operational_history` table definition untouched (Restricted Area) | Migration adds only indexes; `src/adapters/sqlite/migrations/0001-initial-schema.sql:73` table unchanged (0001 not modified) | PASS |
| CP-1 tests pass | `node --import tsx --test test/board-lane-events-migration.test.ts` → 4 pass / 0 fail | PASS |

## Next action

CP-2: implement `BoardEventRecorder.append()` in
`src/application/recording/board-event-recorder.ts` (dedup by operationId, map to
`operational_history` via the existing `append()` API), then write the
idempotency test (SC5) and the operator-local telemetry tests (SC4 recording
failure never blocks; SC7 replay never overrides repository lifecycle state).
