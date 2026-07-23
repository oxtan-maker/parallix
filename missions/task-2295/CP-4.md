# CP-4: Transactional idempotent importers and domain-conformant usage types

## Summary

Implemented `SqliteImporter` with `importBlocklist` (JSON UPSERT) and `importStats` (CSV DELETE+INSERT). Both importers are transactional, idempotent, and skip malformed records without aborting the whole import (SC7). Source files are preserved and SHA-256 digests recorded in the `import_history` ledger. The `usage_statistics` schema and `UsageRecord` type were corrected to conform to the TASK-2294 domain model (`src/domain/usage.ts`): token/tool-call/round counts are `INTEGER`, durations/costs/provider-usage percentages are `REAL`, and SQL `NULL` represents an unavailable (unmeasured) value — distinct from a measured `0`. The importer parses numeric CSV cells into numbers rather than storing them as strings.

### Files created
- `src/adapters/sqlite/importer.ts` — `SqliteImporter` (`importBlocklist`, `importStats`, `getImportHistory`), backup + SHA-256 digest, numeric-cell parsing
- `test/sqlite-importer-cp4.test.ts` — 15 tests

### Files modified
- `src/adapters/sqlite/migrations/0001-initial-schema.sql` — `usage_statistics` numeric columns typed `INTEGER`/`REAL` (was all `TEXT`); NULL = unavailable
- `src/adapters/sqlite/ports.ts` — `UsageRecord` numeric fields typed `number` (was `string`)
- `src/adapters/sqlite/usage-repository.ts` — binds numbers/NULL; `recordFromRow` coerces via `num()`
- `package.json:17` — `engines.node` `>=23.0.0` (built-in SQLite stabilized in Node 23)
- `src/adapters/sqlite/database-adapter.ts` — busy timeout clamped to 0–5000

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Six operator-local domains stored, types conform to the domain model | `src/adapters/sqlite/migrations/0001-initial-schema.sql` — 6 tables; `usage_statistics` INTEGER/REAL columns; test `"usage: numeric columns conform to the domain model (INTEGER/REAL, NULL = unavailable)"` in `test/sqlite-ports-cp2.test.ts` | PASS |
| SC2: node:sqlite confined to the adapter; zero lib importers | tests `"node:sqlite import is confined to src/adapters/sqlite/"` and `"no module under src/platform/runtime/lib imports node:sqlite (SC2 negative)"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC3: Blocklist wired into the real synchronous selector (see CP-3) | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts` `resolveAgentConfig()`; test `"the real selector consumes the SQLite blocklist synchronously and excludes blocked agents"` in `test/sqlite-async-cascade-cp3.test.ts` | PASS |
| SC4: Database path under PARALLIX_HOME | `src/adapters/sqlite/database-path-resolver.ts` `resolveDatabasePath()`; test `"resolves database path under PARALLIX_HOME"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC5: Migrations have immutable IDs, checksums, ledger | `src/adapters/sqlite/migration-runner.ts`; test `"clean install applies all migrations in order"` in `test/sqlite-adapter-cp1.test.ts` | PASS |
| SC6: Connection rules (FK, busy timeout, WAL, params, transactions) | `src/adapters/sqlite/database-adapter.ts` — clamp `Math.min(5000, Math.max(0, …))`; tests in `test/sqlite-adapter-cp1.test.ts` and `"busy timeout is clamped to 0-5000 range"` in `test/sqlite-recovery-cp5.test.ts` | PASS |
| SC7: Importers transactional, idempotent, source preserved, malformed skipped | `src/adapters/sqlite/importer.ts`; tests `"importBlocklist: malformed entries are skipped, valid entries are imported"` and `"importStats: malformed rows are skipped, valid rows are imported"` in `test/sqlite-recovery-cp5.test.ts`; idempotency tests in `test/sqlite-importer-cp4.test.ts` | PASS |
| SC8: Backup, interrupted migration, checksum mismatch, concurrency, recovery | tests `"adapter recovers committed data from backup after the database file is corrupted"`, `"recoverFromBackup reports failure when no backup is available"`, `"concurrent access: two processes contend for the database simultaneously"`, `"checksum mismatch fails closed for modified migration"` in `test/sqlite-recovery-cp5.test.ts` | PASS |
| SC9: No secrets/credentials in schema; import history digest | test `"schema contains no secret/credential/password/token/api_key columns"` in `test/sqlite-adapter-cp1.test.ts`; `import_history` digest in `src/adapters/sqlite/migrations/0002-import-history.sql` | PASS |
| SC10: Repository authority wins; rollback to untouched file readers | tests `"repository authority wins: SQLite only governs the blocklist field, never repo-owned step eligibility"` and `"rollback: with the adapter disabled, the untouched file reader supplies the blocklist"` in `test/sqlite-recovery-cp5.test.ts` | PASS |

### Next action:
See CP-5 for recovery/rollback and the takeover corrections; run `./scripts/verify-local.sh all` and re-request review for task-2295.
