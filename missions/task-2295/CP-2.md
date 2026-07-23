# CP-2: Application repository ports and operator-local domain mappings

## Summary

Implemented all six operator-local domain repository ports and their SQLite implementations, mapped to TASK-2294 domain entities with entity-level authority ownership. All ports remain asynchronous and live behind the model boundary.

### Files created/modified
- `src/adapters/sqlite/ports.ts` — 6 repository port interfaces with domain entity mapping documentation
- `src/adapters/sqlite/blocklist-repository.ts` — `SqliteBlocklistRepository` (maps to `AgentBlock` in `src/domain/agents.ts`)
- `src/adapters/sqlite/usage-repository.ts` — `SqliteUsageRepository` (maps to `AgentRunMeasurement`, `CompletedMissionStatistics` in `src/domain/usage.ts`)
- `src/adapters/sqlite/repository-repository.ts` — `SqliteKnownRepositoriesRepository` (maps to `KnownRepository` in `src/domain/repository.ts`)
- `src/adapters/sqlite/ui-preferences-repository.ts` — `SqliteUIPreferencesRepository` (maps to operator-local cache / board projections)
- `src/adapters/sqlite/operational-history-repository.ts` — `SqliteOperationalHistoryRepository` (maps to local operational history)
- `src/adapters/sqlite/migration-ledger-repository.ts` — `SqliteMigrationLedgerRepository` (maps to migration metadata)
- `src/adapters/sqlite/authority-map.ts` — Exhaustive entity-level authority map: every SQLite field owned by exactly one authority
- `src/adapters/sqlite/index.ts` — Updated barrel exports
- `test/sqlite-ports-cp2.test.ts` — 22 tests covering CRUD operations, upserts, authority map completeness, and async port verification

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: All six domains persisted in SQLite with authority map | `src/adapters/sqlite/authority-map.ts:16-30` (agent_blocklist), `:34-60` (usage_statistics), `:64-72` (known_repositories), `:76-84` (ui_preferences), `:88-96` (operational_history), `:100-108` (schema_migrations), `:112-122` (import_history); test `"authority map covers all six operator-local domains"` in `test/sqlite-ports-cp2.test.ts` | PASS |
| SC1: Each stored field mapped to exactly one authority | `src/adapters/sqlite/authority-map.ts:130-145` (SQLITE_ENTITY_AUTHORITY); test `"authority map: every field maps to exactly one authority owner"` in `test/sqlite-ports-cp2.test.ts` | PASS |
| SC2: Ports remain asynchronous behind model boundary | `src/adapters/sqlite/ports.ts:32` (AgentBlocklistRepository.findAll returns Promise), `:82` (UsageRepository.findAll returns Promise); test `"all repository ports return Promise values"` in `test/sqlite-ports-cp2.test.ts` | PASS |
| SC2: Zero application-layer modules import node:sqlite | `src/adapters/sqlite/database-adapter.ts:1` is the sole `node:sqlite` import; no files under `src/platform/runtime/lib/` import `node:sqlite` | PASS |
| Domain: blocklist maps to AgentBlock | `src/adapters/sqlite/ports.ts:30` (maps to `AgentBlock` in `src/domain/agents.ts`); `src/adapters/sqlite/blocklist-repository.ts:13` (authority mapping); test `"blocklist maps to AgentBlock domain entity fields"` in `test/sqlite-ports-cp2.test.ts` | PASS |
| Domain: usage maps to AgentRunMeasurement | `src/adapters/sqlite/ports.ts:80` (maps to `AgentRunMeasurement`, `CompletedMissionStatistics` in `src/domain/usage.ts`); `src/adapters/sqlite/usage-repository.ts:11` | PASS |
| Domain: known-repos maps to KnownRepository | `src/adapters/sqlite/ports.ts:143` (maps to `KnownRepository` in `src/domain/repository.ts`); `src/adapters/sqlite/repository-repository.ts:12` | PASS |
| CRUD: blocklist round-trip | test `"blocklist: save and findByAgent round-trip"`, `"blocklist: save upserts existing entry"`, `"blocklist: deleteByAgent removes entry"`, `"blocklist: clear removes all entries"` in `test/sqlite-ports-cp2.test.ts` | PASS |
| CRUD: usage round-trip | test `"usage: save and findAll round-trip"`, `"usage: saveAll persists multiple records in transaction"`, `"usage: findWhere filters records"` in `test/sqlite-ports-cp2.test.ts` | PASS |
| CRUD: known-repos, ui-prefs, history, ledger | test `"known-repos: save and findById round-trip"`, `"ui-preferences: save and findByKey round-trip"`, `"operational-history: append and findByType"`, `"migration-ledger: findAll returns applied migrations"` in `test/sqlite-ports-cp2.test.ts` | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |
| Verification gate passes | `./scripts/verify-local.sh all` — 1013 tests PASS | PASS |

## Insertion count

1,469 lines inserted across 10 files (cumulative: ~2,577 across CP-1 + CP-2; approaching the 2,500-line stop rule for the total mission).

Next action: Wire composition-root materialized snapshot and prove no async cascade (CP-3) — integrate the AgentSelectionSnapshotPort with SQLite-backed blocklist data, ensure consumers read from the in-memory snapshot, and add the async-cascade proof test.
