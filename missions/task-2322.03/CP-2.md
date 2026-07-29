# CP-2: Schema initialization, forward migration, and isolated fixtures

> Historical checkpoint: the original schema and CP-numbered test layout
> recorded below were superseded by the relational model and explicitly
> integration-classified suite in `CP-4.md`.

## Summary

Added 14 isolated, fast tests proving the missions table schema initialization and forward-migration behavior. Tests cover clean install (table creation with all 14 columns, write/read verification), upgrade from prior schema 0003 → 0004 (missions table appears, existing board_lane_events preserved), checksum mismatch detection for migration 0004 specifically, interrupted migration recovery (bad migration rolled back, checksum mismatch on retry), backup before irreversible migration 0004, backup/restore of missions data after corruption, concurrent access (sequential writes serialized by WAL, stale writes rejected independently, multiple missions coexisting), and migration version tracking (0004 as current version, idempotent re-run).

All fixtures use isolated temp databases under `os.tmpdir()` with no Forgejo calls, no agent launches, and no CLI subprocesses. Each test creates its own database, applies migrations, exercises the scenario, and cleans up.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SQLite round-trip preserves all checked fields | `test/sqlite-mission-store-cp1.test.ts` "serialize/deserialize round-trip preserves all Mission fields"; `test/sqlite-mission-store-cp2.test.ts` "clean install allows writing and reading a mission" | ✅ Pass |
| Stale writer rejected; rejection leaves aggregate/history unchanged | `test/sqlite-mission-store-cp1.test.ts` "save rejects stale writer with MissionStaleWriteError"; `test/sqlite-mission-store-cp2.test.ts` "concurrent stale writes are each rejected independently" | ✅ Pass |
| Mission transition + LaneTransitionEvent commit atomically | `test/sqlite-mission-store-cp1.test.ts` "saveWithTransition commits both mission state and event"; "saveWithTransition rolls back on stale write" | ✅ Pass |
| RepositoryId stable; KnownRepository replaceable | `test/sqlite-mission-store-cp1.test.ts` "RepositoryId remains stable across saves while KnownRepository can change"; `src/adapters/sqlite/authority-map.ts:163` `MISSIONS_AUTHORITY` | ✅ Pass |
| Clean install proven | `test/sqlite-mission-store-cp2.test.ts` "clean install creates missions table with correct schema"; "clean install allows writing and reading a mission" | ✅ Pass |
| Prior-schema upgrade proven | `test/sqlite-mission-store-cp2.test.ts` "upgrade from prior schema (0003) creates missions table"; "upgrade preserves existing board_lane_events data" | ✅ Pass |
| Checksum mismatch detection proven | `test/sqlite-mission-store-cp2.test.ts` "detects checksum mismatch for mission migration 0004" | ✅ Pass |
| Interrupted migration recovery proven | `test/sqlite-mission-store-cp2.test.ts` "interrupted migration 0004 is rolled back and can be retried" | ✅ Pass |
| Backup proven | `test/sqlite-mission-store-cp2.test.ts` "backup before irreversible migration 0004 creates a .bak file"; "backup preserves missions data for recovery" | ✅ Pass |
| Restore proven | `test/sqlite-mission-store-cp2.test.ts` "recoverFromBackup restores missions table after corruption" | ✅ Pass |
| Concurrent access proven | `test/sqlite-mission-store-cp2.test.ts` "concurrent writes to missions table are serialized by SQLite WAL"; "concurrent stale writes are each rejected independently"; "multiple missions can coexist in the same database" | ✅ Pass |
| Import-boundary coverage | `test/domain-import-boundary.test.ts` "SC1: no src/domain file imports a forbidden infrastructure module"; `test/sqlite-adapter-cp1.test.ts` "no module under src/platform/runtime/lib imports node:sqlite (SC2 negative)" | ✅ Pass |
| No production cutover or unchecked-entity schema | `src/adapters/sqlite/migrations/0004-mission-aggregate.sql` contains only `missions` table; no Attempt/task catalog/worktree/process tables | ✅ Pass |

Next action: Implement red/green tests for complete round trips with complex Review data (including ReviewRound, ReviewerDecision, ImplementerResolution), stale writer edge cases, and injected transaction failures (CP-3).
