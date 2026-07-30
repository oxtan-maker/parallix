# CP-1: MissionCompatibilityImporter class with dry-run discovery and apply path

## Summary of Work Done

Created `MissionCompatibilityImporter` class in `src/adapters/sqlite/mission-importer.ts` implementing the complete dry-run and apply paths for the atomic one-way compatibility import into Mission persistence.

**Key deliverables:**
- `MissionCompatibilityImporter` class accepting repository root directory, database adapter, mission store, and repository ID
- **Dry-run** (`dryRun()`): discovers all legacy task files from `backlog/tasks/`, `backlog/completed/`, `backlog/archive/tasks/`, maps each to a candidate `Mission` domain value via `missionId()` and `missionStatusFromBacklog()`, and produces a `MissionImportReport` with source paths, target identities, validation errors, identity conflicts with existing database rows, and omissions — without executing any database write or modifying any source file
- **Apply** (`apply()`): validates the complete candidate set before any database write, creates a pre-import backup of `parallix.db`, persists via `SqliteMissionStore.save()` ports (no raw SQL INSERT for Mission rows), records import provenance in `import_history`, and is idempotent on replay
- Idempotency: repeated apply on the same unchanged source leaves the database in the same state (no duplicate rows, no version bumps)
- Divergent Mission refusal: apply refuses to overwrite a Mission whose current database state diverges from the source; the divergent Mission is reported in the conflict list and the import proceeds for non-conflicting missions
- Source file preservation: task files, checkpoint artifacts, and review-state files remain byte-for-byte untouched
- Pre-import backup with tested restore path
- YAML-like frontmatter parser supporting both inline values and list items

**New types:**
- `MissionImportCandidate`: a legacy task file mapped to a candidate Mission domain value
- `MissionImportConflict`: a conflict between legacy source and existing database Mission row
- `MissionImportOmission`: a source file that could not be mapped to a Mission
- `MissionImportReport`: report produced by dry-run or apply

**Test coverage:** this checkpoint's 15 unit tests in `test/task-2322.04-mission-import.test.ts` (54 in the file after CP-3, review rounds, and round-4 assignee/NEL validation) cover dry-run discovery (empty backlog, single task, multiple tasks across stores, unmappable status, identity conflict, no conflict, checkpoint discovery, source preservation, deduplication), apply path (valid import, validation rejection, idempotent replay, divergent Mission refusal, backup/restore, mixed import), and round-4 fixes (invalid assignee validation error, NEL 0 preservation, negative/fractional/non-numeric NEL rejection before transaction).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: Dry-run discovers all legacy task files and reports MissionImportReport | `src/adapters/sqlite/mission-importer.ts:781` (discoverCandidates), `src/adapters/sqlite/mission-importer.ts:245` (dryRun), test `"dry-run discovers tasks across all three stores"` in `test/task-2322.04-mission-import.test.ts` | PASS |
| SC2: Apply validates complete candidate set before transaction | `src/adapters/sqlite/mission-importer.ts:282` (validateCandidates, before any write), `src/adapters/sqlite/mission-importer.ts:1395` (validateCandidates body), test `"apply rejects when candidates have validation errors"`, test `"apply refuses to write when assignee is invalid (SC2)"`, test `"apply refuses to write when NEL is invalid (SC2)"` | PASS |
| SC3: Idempotent replay — no duplicate rows, same version | `src/adapters/sqlite/mission-importer.ts:305` (digest check via getLastImport), test `"apply is idempotent on replay with unchanged source"` | PASS |
| SC4: Refuses to overwrite divergent Mission | `src/adapters/sqlite/mission-importer.ts:1414` (detectConflicts), `src/adapters/sqlite/mission-importer.ts:1455` (getDivergenceDetails), test `"apply refuses to overwrite a divergent Mission"` | PASS |
| SC5: Source files byte-for-byte untouched | `src/adapters/sqlite/mission-importer.ts:830` (read-only `fs.readFileSync` in discovery; no write call in the module), test `"dry-run leaves source files byte-for-byte untouched"` | PASS |
| SC6: Pre-import backup and tested restore path | `src/adapters/sqlite/mission-importer.ts:379` (db.backup), `src/adapters/sqlite/mission-importer.ts:759` (restore), test `"apply creates backup that can restore prior database state"` | PASS |
| SC7: Checked domain construction and SqliteMissionStore.save() ports | `src/adapters/sqlite/mission-importer.ts:1504` (toMission), `src/adapters/sqlite/mission-importer.ts:398` (store.save), test `"apply persists valid candidates via SqliteMissionStore.save()"` | PASS |
| SC9: Import provenance in import_history | `src/adapters/sqlite/mission-importer.ts:1614` (recordImport), test `"provenance keeps source_path as the source root and snapshots versions relationally"` | PASS |
| ESLint clean on changed files | `./scripts/verify-local.sh static-analysis` — all stages passed | PASS |
| No focused or skipped tests | `npx tsx --test test/task-2322.04-mission-import.test.ts` — 54 pass, 0 skip | PASS |

## Next action:

Implement CP-3: Checkpoint and Review import — map checkpoint artifacts and review-state files from mission directories into checked `CheckpointData` and `Review` domain objects, parsing Goal Check tables and next action text from checkpoint files, then run `./scripts/verify-local.sh all` to confirm the full gate passes before handoff.
