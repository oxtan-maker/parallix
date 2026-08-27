# CP-3 — Existing-database migration proof

## Work summary

Added focused SQLite upgrade coverage for an existing pre-retirement operator database. The test creates the retired provenance table, applies the normal migration set including `0017`, verifies the retired table is gone, then imports a blocklist and reads its shared import-history entry. The repository gate passes on the final implementation tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Retired importer has no production definition, caller, parser, or dedicated test remaining | `src/adapters/sqlite/`, `test/default-test-suite.test.ts` | PASS |
| Provenance schema is removed while shared import history remains owned by active importers | `src/adapters/sqlite/migrations/0017-retire-mission-import-provenance.sql`, `src/adapters/sqlite/importer.ts`, `test/task-2322-agent-block-import.test.ts` | PASS |
| Existing operator database migrates and opens without the retired importer | `test/sqlite-adapter-cp1.test.ts`, "pre-retirement operator database drops retired provenance and keeps shared import history usable" | PASS |
| Final repository gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: hand off the committed retirement change for review; no compatibility importer remains to operate.
