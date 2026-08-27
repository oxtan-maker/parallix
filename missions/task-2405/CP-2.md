# CP-2 — Remove compatibility import path

## Work summary

Removed `MissionCompatibilityImporter`, its dedicated parser and tests, and the retired importer inventory entry. Removed the former `0006` provenance migration and authority-map entry. Added forward-only migration `0017-retire-mission-import-provenance` to drop `import_mission_versions` from existing databases. `import_history` remains unchanged under `SqliteImporter` and migration `0002-import-history`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Retired importer has no production definition, caller, parser, or dedicated test remaining | `src/adapters/sqlite/`, `test/task-2322.12-review-recovery.integration.test.ts`, `test/task-2377.04-drop-retry-counters-migration.test.ts` | PASS |
| Shared import history remains available to blocklist and statistics importers | `src/adapters/sqlite/importer.ts`, `src/adapters/sqlite/migrations/0002-import-history.sql`, `test/task-2322-agent-block-import.test.ts` | PASS |
| Existing operator database migrates and opens without the retired importer | `src/adapters/sqlite/migrations/0017-retire-mission-import-provenance.sql`, `test/sqlite-adapter-cp1.test.ts` | IN PROGRESS |
| Final repository gate passes | `./scripts/verify-local.sh all` | IN PROGRESS |

Next action: add an upgrade fixture that applies `0017` to an existing operator database and verifies the shared import ledger is usable.
