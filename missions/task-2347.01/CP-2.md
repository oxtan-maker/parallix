## CP-2 — Storage contract

Add `repository_id` column to `board_lane_events` via forward-only migration
0011 (rename-copy-drop pattern with legacy-unscoped backfill). Add
`repositoryId` to `BoardLaneEventEntry` port and `findByRepositoryId` to
`BoardLaneEventRepository`. Implement both in `SqliteBoardLaneEventRepository`.
Wire `repositoryId` through `eventToEntry`/`entryToEvent` and
`SqliteMissionStore.saveWithTransition`. Update authority map and consumer
citation line number.

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `BoardLaneEventEntry` declares required `repositoryId` | `src/application/ports/operation-history.ts:17` | PASS |
| `BoardLaneEventRepository` declares scoped read method | `src/application/ports/operation-history.ts:31` — `findByRepositoryId` | PASS |
| `SqliteBoardLaneEventRepository` implements scoped read | `src/adapters/sqlite/board-lane-event-repository.ts:91` | PASS |
| `board_lane_events` has `NOT NULL` `repository_id` with CHECK | `src/adapters/sqlite/migrations/0011-board-lane-events-repository-id.sql:31` | PASS |
| Idempotency UNIQUE index covers `(repository_id, idempotency_key)` | `src/adapters/sqlite/migrations/0011-board-lane-events-repository-id.sql:72` | PASS |
| Mission lookup index covers `(repository_id, mission_id)` | `src/adapters/sqlite/migrations/0011-board-lane-events-repository-id.sql:76` | PASS |
| Legacy sentinel backfill | `src/adapters/sqlite/migrations/0011-board-lane-events-repository-id.sql:50` — `'legacy-unscoped'` | PASS |
| Same idempotency key across two repos persists | `test/task-2347-01-repository-identity-repro.test.ts:237` — `"two rows with same idempotencyKey under different repositoryId both persist"` | PASS |
| `eventToEntry` carries `repositoryId` | `src/application/recording/board-event-recorder.ts:65` | PASS |
| `entryToEvent` restores `repositoryId` | `src/application/recording/board-event-recorder.ts:93` | PASS |
| Round-trip test (non-null from) | `test/task-2347-01-repository-identity-repro.test.ts:202` — `"entryToEvent(eventToEntry(event)).repositoryId equals original for non-null from"` | PASS |
| Round-trip test (null from) | `test/task-2347-01-repository-identity-repro.test.ts:220` — `"entryToEvent(eventToEntry(event)).repositoryId equals original for null from"` | PASS |
| Authority map updated | `src/adapters/sqlite/authority-map.ts:152` — `repository_id` in `BOARD_LANE_EVENTS_AUTHORITY` | PASS |
| Existing tests pass | `test/board-event-recorder.test.ts` (13 pass), `test/task-2343-board-projection-repro.test.ts` (7 pass), `test/board-lane-events-migration.test.ts` (7 pass) | PASS |

Next action: CP-3 — replace `repositoryId(rootDir)` at `src/adapters/backlog/backlog.ts:799` with stable remote-derived id and add worktree-vs-primary equality test.
