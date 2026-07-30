# Mission: Add atomic one-way compatibility import into Mission persistence (task-2322.04)

## Goal

Provide an explicit, bounded bridge from existing operational records (task Markdown files, checkpoint artifacts, review-state files) to checked Mission aggregates in SQLite. The import materializes and validates domain values first, reports ambiguity without mutating either side, and commits the complete import atomically. It is not a task-catalog migration, a source-repair tool, an exporter, a synchronization mechanism, or a routine command fallback.

## Why Now

ADR 0053 defines SQLite as the sole write authority for Parallix-owned operational state after cutover. The Mission aggregate schema (migration 0004) is in place, and `SqliteMissionStore` can persist checked `Mission`, `CheckpointData`, and `Review` objects. However, existing missions live only in file-backed backlog/mission directories with no path into the database. Without a one-time compatibility import, operators cannot cut over Mission reads/writes to SQLite because the database starts empty. This importer is the bridge that populates the database before cutover, following the same atomic, idempotent, backup-before-import pattern already established by `SqliteImporter.importLegacyBlocklist()` and `importStats()`.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: new `MissionCompatibilityImporter` class with dry-run and apply modes; mapping logic from `BacklogMissionRecord` + checkpoint artifacts + review files into checked domain `Mission` objects; idempotency via source digest and existing-Mission collision detection; unit tests covering dry-run discovery, validation rejection, atomic commit, idempotent replay, divergent-Mission refusal, and backup/restore path

## Scope

- A new `MissionCompatibilityImporter` class in `src/adapters/sqlite/` (or a new file `mission-importer.ts` alongside `importer.ts`) that accepts a repository root directory and produces:
  - **Dry-run**: discovers all legacy task files needed for Mission, CheckpointData, and Review; maps each to a candidate `Mission` domain value via `missionId()`, `checkpointData`, `review` constructors; reports exact source path, target Mission identity, validation errors, identity conflicts with existing database rows, and omissions — without writing to the database or modifying source files.
  - **Apply**: validates the complete candidate set before opening a database transaction; creates a pre-import backup of the database file; constructs checked `Mission` objects using domain constructors (not inferred rows); persists via `SqliteMissionStore.save()` ports (not raw SQL); records import provenance (source root, digest, imported count) in `import_history`; leaves the database unchanged when any record is invalid or ambiguous; refuses to overwrite a Mission whose current database state diverges from the source.
- Idempotent replay: running apply again on the same unchanged source leaves the database in the same state (no duplicate rows, no version bumps).
- Source files (task Markdown, checkpoint artifacts, review-state files, NEL records) remain byte-for-byte untouched — no repair, normalization, deletion, or export.
- A pre-import backup of `parallix.db` and a tested restore path that recovers the prior database after an interrupted or rejected import.
- No production read or write is redirected; no dual-write, shadow-write, background import, or file fallback is introduced by this change.

## Out of Scope

- Task-catalog migration (importing every backlog task as a domain entity regardless of Mission relevance).
- Source-repair tooling (normalizing, fixing, or deleting legacy files).
- Exporter (writing database content back to files).
- Synchronization mechanism (ongoing bidirectional sync between files and database).
- Routine command fallback (using files as a runtime read fallback when the database is unavailable).
- Importing `AgentRunMeasurement`, `MissionOutcome`, `SessionMarker`, or `LaneTransitionEvent` — those are separate cutover steps per ADR 0053 staging.
- Introducing an `Attempt` domain entity (guarded by `test/domain-attempt-guard.test.ts`).

## Success Criteria

- SC1: Dry-run discovers all legacy task files (tasks/, completed/, archive/tasks/) and reports a `MissionImportReport` with exact `sourcePath`, target `missionId`, validation errors, identity conflicts with existing `missions` rows, and omissions — without executing any database write or modifying any source file.
- SC2: Apply validates the complete candidate set before opening a database transaction; if any record fails domain construction (e.g., invalid `missionId`, invalid `MissionStatus`, missing required field), the transaction is never opened and the database is unchanged.
- SC3: Repeated apply on the same unchanged source is idempotent — the database state (row count, version values, `import_history` entries) is identical after the second run, and no duplicate `missions` rows are created.
- SC4: Apply refuses to overwrite a Mission whose current database state diverges from the source (e.g., the database has a newer `version` or different `title` than the source file); the divergent Mission is reported in the conflict list and the import proceeds for non-conflicting missions.
- SC5: Source task files, checkpoint artifacts, review-state files, and NEL records remain byte-for-byte untouched after both dry-run and apply — verified by SHA-256 digest comparison.
- SC6: A pre-import backup of `parallix.db` is created before the apply transaction; a `restore(backupPath)` call recovers the prior database state after an interrupted import.
- SC7: The importer invokes checked domain construction (`missionId()`, `missionLabels()`, `CheckpointData`, `Review`) and persists via `SqliteMissionStore.save()` ports — no raw SQL INSERT for Mission rows in the importer code.
- SC8: No production read or write is redirected and no dual-write, shadow-write, background import, or file fallback is introduced — verified by the absence of any `MissionStore.load()` call in the importer's apply path and the absence of new runtime fallback logic.
- SC9: Import provenance (source root path, digest, imported count, skipped count, timestamp) is recorded in `import_history` by the `recordImport` ledger method.

## Risks and Assumptions

- **Risk**: Legacy task files may have inconsistent status vocabulary (e.g., "ready", "approved") that does not map cleanly to `MissionStatus`. Mitigation: reuse `missionStatusFromBacklog()` from `mission-materialization.ts` and report unmappable statuses as validation errors in dry-run.
- **Risk**: Checkpoint artifacts in mission directories may not match the checked `CheckpointData` structure. Mitigation: the importer validates each checkpoint through `isCheckpointName()` and domain constructors; invalid checkpoints are reported as validation errors and block the transaction.
- **Risk**: Review-state files may reference provider-specific IDs that the importer cannot resolve. Mitigation: review import is bounded to the data present in the mission directory; missing provider data is treated as optional and does not block the import.
- **Assumption**: The SQLite schema (migration 0004) is fully applied before the import runs — the `missions` table and all child tables exist.
- **Assumption**: `SqliteMissionStore` is available as a dependency and its `save()` method handles the full aggregate persist (Missions, labels, checkpoints, goal checks, reviews).
- **Assumption**: The repository root directory contains the standard `backlog/tasks/`, `backlog/completed/`, `backlog/archive/tasks/`, and `missions/<slug>/` directory structure.

## Checkpoints

- CP 1: `MissionCompatibilityImporter` class skeleton with dry-run discovery — discovers legacy task files from `backlog/tasks/`, `backlog/completed/`, `backlog/archive/tasks/`, maps each to a candidate `Mission` identity via `missionId()` and `missionStatusFromBacklog()`, and produces a `MissionImportReport` with source paths, target identities, validation errors, and conflicts. Unit tests cover: empty backlog, single task, multiple tasks across stores, unmappable status, and identity conflict with existing database rows.
- CP 2: Apply path with atomic transaction, backup, and idempotency — validates complete candidate set before transaction, creates pre-import backup of `parallix.db`, persists via `SqliteMissionStore.save()` ports, records provenance in `import_history`, and is idempotent on replay. Unit tests cover: valid import, validation rejection (no transaction opened), idempotent replay (same state), divergent Mission refusal, and backup/restore after interrupted import.
- CP 3: Checkpoint and Review import — maps checkpoint artifacts and review-state files from mission directories into checked `CheckpointData` and `Review` domain objects; handles missing artifacts gracefully (empty collections, not errors). Unit tests cover: mission with checkpoints, mission with review rounds, mission with both, and mission with no artifacts.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/adapters/sqlite/mission-importer.ts:42` (must point to an existing file and line)
  2. **Test names** — e.g., `"dry-run discovers tasks across all three stores"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2322.04-mission-import.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2322.04-mission-import.test.ts` ``, `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Dry-run discovers legacy tasks | `src/adapters/sqlite/mission-importer.ts:120`, test `"dry-run discovers tasks across all three stores"` in `test/task-2322.04-mission-import.test.ts` | PASS |
| Apply is atomic — no partial state on failure | `src/adapters/sqlite/mission-importer.ts:205`, test `"apply rolls back on validation error"` | PASS |
| Import provenance recorded | `src/adapters/sqlite/mission-importer.ts:230`, `import_history` table via `recordImport` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/domain/mission.ts` — do not modify the `Mission` domain type or its constructors; the importer must work within the existing domain model.
- `src/adapters/sqlite/migrations/0004-mission-aggregate.sql` — do not modify the schema; the importer uses the existing tables.
- `src/adapters/sqlite/mission-store.ts` — do not modify `SqliteMissionStore`; the importer calls its existing `save()` method.
- `src/adapters/backlog/mission-materialization.ts` — do not modify; reuse `missionStatusFromBacklog()` and `BacklogMissionRecord` types.
- `src/application/domain-ports.ts` — do not modify the `MissionStore` interface.
- `src/adapters/sqlite/importer.ts` — do not modify the existing `SqliteImporter` class; the new `MissionCompatibilityImporter` is a separate class.

## Stop Rules

- Stop if the import requires modifying the `Mission` domain type (`src/domain/mission.ts`) — the importer must adapt to the domain, not the reverse.
- Stop if the import introduces a dual-write or runtime fallback for Mission reads — this is strictly a one-time pre-cutover import.
- Stop if the import modifies source task files (repair, normalization, deletion) — source files are read-only inputs.
- Stop if the import introduces an `Attempt` domain entity — that is guarded by `test/domain-attempt-guard.test.ts` and out of scope.
- Stop if the import scope expands to include `AgentRunMeasurement`, `MissionOutcome`, `SessionMarker`, or `LaneTransitionEvent` — those are separate cutover steps per ADR 0053.
