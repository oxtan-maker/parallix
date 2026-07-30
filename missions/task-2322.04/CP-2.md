# CP-2: Apply path with atomic transaction, backup, and idempotency

## Summary of Work Done

Implemented the complete apply path in `MissionCompatibilityImporter` with full transactional integrity, backup protection, and idempotent replay support. Addressed review findings for atomic persistence, idempotent provenance, and inline assignee parsing.

**Key deliverables:**
- Apply validates the complete candidate set before any database write (SC2)
- Creates pre-import backup of `parallix.db` via `SqliteDatabaseAdapter.backup()` (SC6)
- **Atomic batch persist**: all Mission aggregates and the `import_history` ledger entry commit or roll back together via `SqliteMissionStore.save()` ports inside a single `db.beginTransaction()/commitTransaction()` scope (SC2, SC7, SC9). Nested transaction calls in `save()` are no-ops via depth tracking in `SqliteDatabaseAdapter`.
- Records import provenance in `import_history` via the `recordImport` ledger method (SC9)
- **Idempotent replay with no ledger bloat**: when all candidates are unchanged, apply returns early before backup/ledger creation — `import_history` row count is identical across replays (SC3)
- **Provenance lookups scoped to the source root**: `import_history` is a shared ledger (blocklist, stats, and other repository roots write to it), so `getLastImport()` filters by `source_path = rootDir` instead of taking the globally newest row; the snapshot insert binds to `last_insert_rowid()`. Without this, an unrelated import landing between two unchanged applies hid this root's version snapshot and caused a needless re-save and version bump (SC3)
- **Complete aggregate comparison**: the persisted rows are rehydrated with the store's own `hydrateMission()` serializer and compared field by field against the candidate, so labels, checkpoints (name, raw filename, first line, next action, Goal Check rows), the whole review and the external task ref all participate — not counts or a hand-picked subset (SC3, SC4)
- **Relational provenance**: `import_history.source_path` holds only the source root; the per-Mission version snapshot lives in `import_mission_versions` (INTEGER version, foreign keys to the ledger entry and the Mission) added by migration `0006-import-mission-versions.sql` (SC9)
- **Schema precondition is checked, not assumed**: `assertSchemaPresent()` introspects `sqlite_master` before any discovery or write and raises `MissionImportSchemaError` naming the missing tables, so a database that has not had every pending migration applied fails with an actionable precondition error instead of a bare SQLite `no such table` part-way through apply. Migration `0006` ships in the default migration set that `initOperatorState()` and `application-services` apply on every open, so the normal deployment path always satisfies the precondition
- `restore(backupPath)` API: recovers the pre-import database state after an interrupted import (SC6)
- Divergent Mission refusal: the importer refuses to overwrite a Mission whose current database state diverges from the source; the divergent Mission is reported in the conflict list and the import proceeds for non-conflicting missions (SC4)
- Source files remain byte-for-byte untouched after both dry-run and apply (SC5)
- **Inline YAML list assignee parsing**: handles `assignee: [codex]` and `assignee: [codex, claude]` formats from production backlog files
- **Checkpoint name validation**: validates each artifact name via `isCheckpointName()` before persistence; invalid names and unreadable files are reported as validation errors

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2: Apply validates complete candidate set before transaction | `src/adapters/sqlite/mission-importer.ts:282` (validateCandidates called before any save), test `"apply rejects when candidates have validation errors"` in `test/task-2322.04-mission-import.test.ts` | PASS |
| SC2: Atomic batch — Missions + provenance commit/rollback together | `src/adapters/sqlite/mission-importer.ts:394` (db.beginTransaction wraps the store.save loop and recordImport), test `"apply rolls back Missions when provenance ledger insert fails"` | PASS |
| SC3: Idempotent replay — no duplicate rows, same version, same history count | `src/adapters/sqlite/mission-importer.ts:305` (digest check: skip all when source unchanged), `src/adapters/sqlite/mission-importer.ts:498` (getLastImport: raw SQL over import_history + import_mission_versions, scoped to `source_path = rootDir`), tests `"apply does not append import_history on unchanged replay"`, `"unrelated import_history entries do not break unchanged-replay idempotency"` | PASS |
| SC3/SC4: Divergence compares the complete persisted aggregate | `src/adapters/sqlite/mission-importer.ts:641` (loadPersistedMissions rehydrates DB rows through `hydrateMission`), `src/adapters/sqlite/mission-importer.ts:1420` (getDivergenceDetails walks every aggregate field), tests `"apply reports divergence when only a label value changes at the same count"`, `"apply reports divergence when only checkpoint metadata changes"`, `"apply reports divergence when only the review reviewer changes"` | PASS |
| SC4: No false conflict when the aggregate is unchanged | `src/adapters/sqlite/mission-importer.ts:596` (detectDivergenceViaSQL), test `"apply reports no conflict for an unchanged checkpoint that has no Goal Check rows"` | PASS |
| SC4: Refuses to overwrite divergent Mission | `src/adapters/sqlite/mission-importer.ts:596` (detectDivergenceViaSQL), `src/adapters/sqlite/mission-importer.ts:401` (stale-write from save()), test `"apply refuses to overwrite a divergent Mission"` | PASS |
| SC4: Detects database divergence on unchanged-source replay | `src/adapters/sqlite/mission-importer.ts:549` (detectDatabaseDivergence compares DB versions against the recorded snapshot), test `"replay with unchanged source detects database divergence (SC4 + SC8)"` | PASS |
| SC5: Source files byte-for-byte untouched | `src/adapters/sqlite/mission-importer.ts:830` (read-only file operations), test `"dry-run leaves source files byte-for-byte untouched"` | PASS |
| SC6: Pre-import backup and restore(backupPath) API | `src/adapters/sqlite/mission-importer.ts:379` (db.backup), `src/adapters/sqlite/mission-importer.ts:759` (restore), test `"restore(backupPath) recovers the pre-import database state"` | PASS |
| SC7: Checked domain construction and SqliteMissionStore.save() ports | `src/adapters/sqlite/mission-importer.ts:1469` (toMission), `src/adapters/sqlite/mission-importer.ts:398` (store.save), test `"apply persists valid candidates via SqliteMissionStore.save()"` | PASS |
| SC8: No MissionStore.load() in apply path | `src/adapters/sqlite/mission-importer.ts:498` (getLastImport: raw SQL), `src/adapters/sqlite/mission-importer.ts:525` (getExistingMissionVersions: raw SQL), `src/adapters/sqlite/mission-importer.ts:641` (loadPersistedMissions: raw SQL + `hydrateMission`, not the store port), test `"replay with unchanged source detects database divergence (SC4 + SC8)"` | PASS |
| Schema precondition: 0006 ships in the default migration set applied on every database open | `src/adapters/sqlite/adapter-factory.ts:73` (`loadDefaultMigrations()` + `applyPending`), `src/adapters/sqlite/migration-runner.ts:153` (directory scan, sorted), `src/platform/runtime/lib/composition/application-services.ts:144`, test `"every migration the importer needs ships in the default migration set"` | PASS |
| Schema precondition: a partially migrated database is refused, not corrupted | `src/adapters/sqlite/mission-importer.ts:473` (assertSchemaPresent introspects sqlite_master), `src/adapters/sqlite/mission-importer.ts:187` (MissionImportSchemaError), test `"apply fails with a named precondition error when a required table is absent"` | PASS |
| SC9: Provenance — source_path is the source root, versions are relational | `src/adapters/sqlite/mission-importer.ts:1579` (recordImport writes import_history then one import_mission_versions row per Mission), `src/adapters/sqlite/migrations/0006-import-mission-versions.sql`, `src/adapters/sqlite/authority-map.ts:131` (IMPORT_MISSION_VERSIONS_AUTHORITY), tests `"provenance keeps source_path as the source root and snapshots versions relationally"`, `"deleting an import_history row cascades its version snapshot away"` | PASS |

## Next action:

Implement CP-3: Checkpoint and Review import — parse Goal Check tables and next action text from checkpoint files, read review-state.json and construct Review domain objects.
