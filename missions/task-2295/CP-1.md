# CP-1: SQLite schema and migration runner

## Summary

Created the `src/adapters/sqlite/` adapter layer with schema, migration runner, database adapter, path resolver, and adapter factory. All six operator-local domains are persisted in SQLite with connection rules enforced. The `node:sqlite` import is confined to the adapter layer.

### Files created
- `src/adapters/sqlite/migrations/0001-initial-schema.sql` — all six operator-local domain tables + schema_migrations ledger
- `src/adapters/sqlite/migrations/0002-import-history.sql` — import history ledger for source path, digest, and idempotency tracking
- `src/adapters/sqlite/database-adapter.ts` — `SqliteDatabaseAdapter` wrapping `DatabaseSync` with FK, busy timeout, WAL, parameterized SQL, explicit transactions
- `src/adapters/sqlite/migration-runner.ts` — `SqliteMigrationRunner` with immutable IDs, SHA-256 checksums, transaction boundaries, pre-migration backup, and `loadDefaultMigrations()`
- `src/adapters/sqlite/database-path-resolver.ts` — `resolveDatabasePath()` under `<PARALLIX_HOME>/parallix.db` and `verifyDatabasePathIsolation()`
- `src/adapters/sqlite/adapter-factory.ts` — `initOperatorState()` composition entry point
- `src/adapters/sqlite/index.ts` — barrel exports
- `test/sqlite-adapter-cp1.test.ts` — 22 tests covering connection rules, migrations, schema correctness, path resolution, and boundary enforcement

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Schema maps all six operator-local domains | `src/adapters/sqlite/migrations/0001-initial-schema.sql:14` (agent_blocklist), `:18` (usage_statistics), `:56` (known_repositories), `:68` (ui_preferences), `:75` (operational_history), `:89` (schema_migrations); `src/adapters/sqlite/migrations/0002-import-history.sql:4` (import_history); test `"schema maps all six operator-local domains"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC2: Only adapter imports node:sqlite | `src/adapters/sqlite/database-adapter.ts:1` is the sole `node:sqlite` import; test `"node:sqlite import is confined to src/adapters/sqlite/"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC5: Migrations have immutable IDs, SHA-256 checksums, transaction boundaries, ledger | `src/adapters/sqlite/migration-runner.ts:28` (computeChecksum), `:58` (applyPending with checksum verification), `:130` (beginTransaction/execute/commitTransaction per migration); test `"detects checksum mismatch for modified migration"` and `"migration ledger records version, checksum, and timestamp"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC5: Clean-install and previous-schema upgrade tests pass | test `"applies clean-install migrations from scratch"` and `"previous-schema upgrade applies pending migrations only"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC6: Foreign keys enforced | `src/adapters/sqlite/database-adapter.ts:73` (`PRAGMA foreign_keys = ON`); test `"enables foreign keys on connection"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC6: Busy timeout bounded to 5000ms | `src/adapters/sqlite/database-adapter.ts:76` (`PRAGMA busy_timeout = ${busyTimeout}` default 5000); test `"sets bounded busy timeout on connection"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC6: WAL mode where supported | `src/adapters/sqlite/database-adapter.ts:80` (`PRAGMA journal_mode = WAL` with catch fallback); test `"enables WAL mode on connection"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC6: Parameterized SQL for dynamic values | `src/adapters/sqlite/database-adapter.ts:103` (prepare/run with params); test `"uses parameterized SQL for dynamic values"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC6: Explicit transactions for multi-statement changes | `src/adapters/sqlite/database-adapter.ts:128-147` (beginTransaction/commitTransaction/rollbackTransaction); test `"wraps multi-statement changes in explicit transactions"` and `"rolls back transaction on failure"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC9: No secret/credential fields in schema | test `"schema contains no secret/credential/password/token/api_key columns"` in `test/sqlite-adapter-cp1.test.ts` verifies all columns across all tables | PASS |
| SC4: Database path under PARALLIX_HOME | `src/adapters/sqlite/database-path-resolver.ts:13` (`path.join(home, 'parallix.db')`); test `"resolves database path under PARALLIX_HOME"` and `"database path is never under a target repository directory"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |
| Verification gate passes | `./scripts/verify-local.sh all` — 960 tests PASS | PASS |

## Insertion count

1,108 lines inserted across 8 files (well within the 2,500-line stop rule).

Next action: Implement application repository ports and operator-local domain mappings (CP-2) — map all six domains onto TASK-2294 domain entities with entity-level authority ownership, and implement async repository ports behind the model boundary.
