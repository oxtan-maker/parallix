# CP-1 — Retired importer ownership map

## Work summary

Mapped the retired compatibility path before editing. `MissionCompatibilityImporter` has no production caller; its only callers are the dedicated compatibility/import recovery tests. `mission-import-parsing.ts` is consumed only by that importer and its direct parsing test. The shared `import_history` ledger remains owned by `SqliteImporter` and migration `0002-import-history`; blocklist and statistics imports retain it. `import_mission_versions` and migration `0006-import-mission-versions` are exclusive compatibility-import provenance and are slated for removal.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Retired importer has no production definition, caller, parser, or dedicated test remaining | `src/adapters/sqlite/mission-importer.ts`, `test/task-2322.04-mission-import.test.ts`, `test/task-2322.12-review-recovery.integration.test.ts`, `test/mission-import-parsing.test.ts` | IN PROGRESS |
| Shared import history remains available to blocklist and statistics importers | `src/adapters/sqlite/importer.ts`, `src/adapters/sqlite/migrations/0002-import-history.sql` | PASS |
| Existing operator database migrates and opens without the retired importer | `test/sqlite-adapter-cp1.test.ts`, `src/adapters/sqlite/migration-runner.ts` | IN PROGRESS |
| Final repository gate passes | `./scripts/verify-local.sh all` | IN PROGRESS |

Next action: remove the importer-exclusive source, tests, parser, migration, and authority map while retaining `import_history` through `SqliteImporter`.
