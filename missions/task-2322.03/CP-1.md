# CP-1: Persistence contract mapping for the checked Mission aggregate

> Historical checkpoint: the expected-status/JSON-column design recorded
> below was superseded by the relational, version-checked review correction in
> `CP-4.md`. CP-4 is the final implementation and evidence record.

## Summary

Mapped the checked Mission aggregate and its nested types to an SQLite persistence contract. Created the `missions` table (migration `0004-mission-aggregate`) with all 14 columns covering every checked field: `id`, `repository_id`, `title`, `status`, `raw_status`, `assignee`, `labels`, `checkpoints`, `review`, `net_engineering_lines`, `closed_at`, `version`, `known_repository_path`, and `known_repository_display_name`.

Implemented `SqliteMissionStore` behind the `MissionStore` port (`src/application/domain-ports.ts:10`), providing `load()`, `save()` with optimistic concurrency via `expectedStatus`, and `saveWithTransition()` for atomic state-and-event persistence. The `MissionStaleWriteError` class signals rejected stale writes without partial changes.

Recorded the persistence contract as checked constants: `MISSION_PERSISTENCE_FIELDS` enumerates all top-level and nested fields required for round-trip coverage; `MISSION_CONCURRENCY_CONTRACT` specifies the expected-status mechanism; `REPOSITORY_IDENTITY_MAPPING` distinguishes the stable `repository_id` identity column from replaceable `known_repository_path`/`known_repository_display_name` cache columns. Updated `MISSIONS_AUTHORITY` in the authority map with `operator-local` for identity fields and `operator-local-cache` for KnownRepository cache fields.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SQLite round-trip preserves repositoryId, status, rawStatus, assignee, labels, closedAt, CheckpointData, Review | `test/sqlite-mission-store-cp1.test.ts` test "serialize/deserialize round-trip preserves all Mission fields"; `src/adapters/sqlite/mission-serialization.ts:48` `serializeMissionRow()`; `src/adapters/sqlite/mission-serialization.ts:100` `deserializeMission()` | ✅ Pass |
| Stale writer rejected by checked version/concurrency contract; rejection leaves aggregate and history unchanged | `test/sqlite-mission-store-cp1.test.ts` test "save rejects stale writer with MissionStaleWriteError"; test "stale write rejection leaves stored aggregate unchanged"; `src/adapters/sqlite/mission-store.ts:42` `MissionStaleWriteError`; `src/adapters/sqlite/mission-serialization.ts:193` `MISSION_CONCURRENCY_CONTRACT` | ✅ Pass |
| Mission transition and LaneTransitionEvent commit in one transaction; failure leaves neither changed | `test/sqlite-mission-store-cp1.test.ts` test "saveWithTransition commits both mission state and event"; test "saveWithTransition rolls back on stale write"; `src/adapters/sqlite/mission-store.ts:107` `saveWithTransition()` | ✅ Pass |
| RepositoryId is stable Mission reference; KnownRepository path/display are replaceable cache | `test/sqlite-mission-store-cp1.test.ts` test "RepositoryId remains stable across saves while KnownRepository can change"; `src/adapters/sqlite/mission-serialization.ts:212` `REPOSITORY_IDENTITY_MAPPING`; `src/adapters/sqlite/authority-map.ts:163` `MISSIONS_AUTHORITY.repository_id` = `operator-local`, `known_repository_path` = `operator-local-cache` | ✅ Pass |
| Database initialization and forward migration proven for clean install | `test/sqlite-mission-store-cp1.test.ts` test "missions table is created by migration 0004"; `src/adapters/sqlite/migrations/0004-mission-aggregate.sql`; `./scripts/verify-local.sh static-analysis` passes | ✅ Pass |
| Import-boundary coverage: application/UI use ports, do not import SQLite adapter or SQL | `test/domain-import-boundary.test.ts` test "SC1: no src/domain file imports a forbidden infrastructure module"; `test/sqlite-adapter-cp1.test.ts` test "no module under src/platform/runtime/lib imports node:sqlite (SC2 negative)"; `src/application/domain-ports.ts:10` `MissionStore` port | ✅ Pass |
| No production cutover, legacy read/repair, shadow write, or table for Attempt/task catalog/worktree/process | `src/adapters/sqlite/migrations/0004-mission-aggregate.sql` contains only `missions` table; no Attempt, task catalog, worktree, or process tables; `src/adapters/sqlite/mission-store.ts` implements `MissionStore` port without changing production routing | ✅ Pass |

Next action: Add schema initialization fixtures, forward migration from prior schema (0003 → 0004), checksum mismatch detection, interrupted migration recovery, backup, restore, and concurrent-access fixtures for the missions table (CP-2).
