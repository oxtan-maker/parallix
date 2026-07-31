# Mission: Cut over Mission authority atomically and retire lifecycle file persistence (task-2322.07)

## Goal

Replace `CompatibilityMissionStore` (file-backed: task Markdown, `CP-N.md`, `nel-record.json`, `review-state.json`) with `SqliteMissionStore` as the sole production authority for every Mission read and write — including current state, `CheckpointData`, `Review`, structured NEL data, and `LaneTransitionEvent` history — in a single composition-root change. A preflight import gate must prove completeness before cutover; the legacy compatibility adapter is deleted or made unreachable from production wiring; and database unavailability fails operations without falling back to legacy files.

## Why Now

TASK-2322.04 and TASK-2322.06 deliver the import pipeline and application use cases that make this cutover possible. ADR 0053 explicitly requires a single authority switch with no steady-state dual-write or fallback writer. Until this gate passes, the compatibility store is the only production path and the SQLite adapter is exercised only by isolated test fixtures, leaving the architecture unable to deliver atomic mission transitions, stale-write rejection, or cross-repository queries.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: composition-root wiring change across `application-services.ts`, preflight import gate in commands, compatibility adapter retirement, ADR0053 inventory updates, and E2E coverage for cold-start-after-import and direct legacy file mutation.

## Scope

- **Composition-root cutover**: `createMissionApplicationServices()` in `src/platform/runtime/lib/composition/application-services.ts` must construct `SqliteMissionStore` instead of `CompatibilityMissionStore` and wire it through all Mission use cases (`MissionIntakeService`, `MissionLifecycleService`, `MissionIntegrationService`, `MissionCheckpointService`, `MissionHandoffService`).
- **Preflight import gate**: A command or pre-check verifies the complete import (via `MissionCompatibilityImporter.dryRun()` / `apply()`) covers all discoverable Missions with zero validation errors and zero unresolved conflicts before allowing the cutover.
- **Legacy adapter retirement**: `src/adapters/backlog/compatibility-mission-store.ts` is either deleted or made unreachable from production composition (import removed from `application-services.ts`). The `authority` field in `MissionApplicationServices` changes from `'compatibility'` to `'sqlite'`.
- **ADR0053 inventory update**: All entries in `src/platform/runtime/lib/core/durable-state-inventory.ts` with `cutoverTask: 'TASK-2322.07'` and `pathType: 'compatibility'` for Mission/CheckpointData/Review concepts are updated to `pathType: 'default'` with `fileLocation` pointing to the SQLite adapter, or removed if their function is now fully subsumed by SQLite.
- **File-backed lifecycle removal**: Default commands, `status`, TUI, and shared board projections no longer read, write, reconcile, or use as fallback authority: task lifecycle frontmatter fields, `CP-N.md` checkpoint files, `review-state.json`, or `nel-record.json` for the Mission domain.
- **External task boundary**: External task material is accessed only through the explicit planning/intake boundary; edits to the original task file after materialization cannot change Mission lifecycle state.
- **Fail-closed on database unavailability**: Database unavailability, constraint failure, or stale version fails the requested operation without writing legacy files or partially performing dependent external effects.
- **E2E test coverage**: Tests for cold start after import, restart, concurrent stale writers, every supported Mission transition, review and integration flow, and direct mutation of retired legacy files.
- **Architecture inventory**: No remaining Mission-domain exceptions in the ADR0053 persistence inventory.

## Out of Scope

- `AgentRunMeasurement`, `MissionOutcome`, `SessionMarker`, and `AgentBlock` cutover (those are separate domains, some already cut over).
- External task catalog import or planning document redesign (intake boundary remains unchanged).
- Git observations, worktree presence, or branch topology persistence (Git/OS remain authoritative).
- Workflow configuration, prompts, schemas, or agent-selection policy persistence (file-backed inputs unchanged).
- Multi-user coordination or remote database (single operator-local SQLite).
- `Attempt` domain entity introduction (explicitly excluded by ADR 0053).
- `px draft` command task-creation behavior (intake creation stays with the existing draft command).

## Success Criteria

- SC1: `createMissionApplicationServices()` constructs `SqliteMissionStore` and the `authority` field in `MissionApplicationServices` equals `'sqlite'` in production composition. Evidence: `src/platform/runtime/lib/composition/application-services.ts` contains `new SqliteMissionStore(db)` and `authority: 'sqlite'`.
- SC2: `MissionCompatibilityImporter.apply()` is invoked as a preflight gate before cutover and blocks with an actionable report when any candidate has validation errors or unresolved conflicts. Evidence: a command or pre-check path calls `.dryRun()` and `.apply()` and the report's `candidates[].validationErrors` and `conflicts[]` are non-empty on failure.
- SC3: Default command paths (`status`, transitions, TUI reads, board projections) load Mission state from `SqliteMissionStore.load()` and never from `CompatibilityMissionStore.load()`, task frontmatter, `CP-N.md` files, `review-state.json`, or `nel-record.json`. Evidence: grep for `CompatibilityMissionStore` in `src/platform/runtime/lib/commands/` and `src/interfaces/tui/` shows no production imports; `SqliteMissionStore` is the sole `MissionStore` instance.
- SC4: External task material is accessed only through the intake boundary (`MissionIntakeService`) and edits to the original backlog task file after materialization do not change the `Mission.status`, `Mission.assignee`, or `Mission.closedAt` persisted in SQLite. Evidence: `externalTaskRef` in `Mission` is an `ExternalTaskRef` value object, not a live file read.
- SC5: Database unavailability (connection failure), constraint violation, or stale version (`MissionStaleWriteError`) causes the operation to fail immediately without writing any legacy file (task frontmatter, checkpoint, NEL record, review state). Evidence: no `catch` block in the Mission use cases falls back to `CompatibilityMissionStore` or file I/O.
- SC6: E2E test suite covers: (a) cold start after import, (b) restart recovery, (c) concurrent stale writers, (d) every supported Mission transition (`backlog`→`refined`→`active`→`review`→`integration`→`done`), (e) review and integration flow, and (f) direct mutation of retired legacy files. Evidence: test file `test/e2e-mission-sqlite-cutover.test.ts` (or equivalent) with named test cases for each scenario.
- SC7: `CompatibilityMissionStore` is deleted or has no production import from `application-services.ts`, `commands/`, or `tui/`. The ADR0053 inventory has zero entries with `cutoverTask: 'TASK-2322.07'` for Mission/CheckpointData/Review concepts. Evidence: `grep -r "CompatibilityMissionStore" src/platform/runtime/lib/composition/application-services.ts` returns nothing; `durable-state-inventory.ts` entries for Mission/CheckpointData/Review have `cutoverTask: null` or a different task.
- SC8: `LegacyActiveAdapter.missionStore()` resolves to `SqliteMissionStore` (via updated `createMissionApplicationServices()`). Evidence: `src/platform/runtime/lib/adapters/legacy-active-adapter.ts` calls `createMissionApplicationServices(rootDir).store` which now returns `SqliteMissionStore`.

## Risks and Assumptions

- **Risk**: The import pipeline (TASK-2322.06) may produce edge-case conflicts for missions with divergent state between legacy files and SQLite. Mitigation: the preflight gate (`dryRun` + `apply`) surfaces all conflicts with actionable details before any cutover wiring is finalized.
- **Risk**: A command path not covered by the application use cases (e.g., a direct `backlog.ts` call from a CLI command) might still read task frontmatter as lifecycle authority. Mitigation: exhaustive grep of `getTaskFrontmatterValue` and `resolveTaskFile` in command paths; any direct lifecycle read must be routed through `MissionLifecycleService`.
- **Risk**: SQLite unavailability during startup (missing built-in module, migration failure) could break all Mission commands. Mitigation: the composition root must decide fail-closed vs. degraded mode consistently; the current `materializeOperatorState()` catch pattern returns `null` and this mission must extend that to the Mission boundary.
- **Assumption**: TASK-2322.04 (import) and TASK-2322.06 (use cases) are complete and their SQLite tables, migrations, and serialization logic are stable.
- **Assumption**: The `MissionCompatibilityImporter` dry-run and apply paths are correct and idempotent, as tested in TASK-2322.06.
- **Assumption**: No new Mission-domain consumers are introduced concurrently with this cutover.

## Checkpoints

- CP 1: Preflight import gate — implement the pre-check command or integration step that runs `MissionCompatibilityImporter.dryRun()` and `apply()`, produces the `MissionImportReport`, and blocks cutover with actionable output when validation errors or unresolved conflicts exist.
- CP 2: Composition-root cutover — update `createMissionApplicationServices()` to construct `SqliteMissionStore` with the operator-local database, wire it through all Mission use cases, and change `authority` to `'sqlite'`. Verify all commands and TUI read/write through the SQLite store.
- CP 3: Legacy adapter retirement and inventory update — remove `CompatibilityMissionStore` from production wiring (delete or make unreachable), update `ADR0053_PERSISTENCE_INVENTORY` entries for Mission/CheckpointData/Review to `pathType: 'default'` with SQLite locations or remove TASK-2322.07 cutover references, and verify no remaining Mission-domain exceptions exist.
- CP 4: E2E test coverage and verification — author E2E tests for cold start after import, restart, concurrent stale writers, every Mission transition, review/integration flow, and direct legacy file mutation. Run verification gate.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/platform/runtime/lib/composition/application-services.ts:42` (must point to an existing file and line)
  2. **Test names** — e.g., `"cold start after import: all Missions load from SQLite"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-mission-sqlite-cutover.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh static-analysis` ``, `` `node --import tsx test/e2e-mission-sqlite-cutover.test.ts` ``, `` `npm run build` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SqliteMissionStore wired in composition root | `src/platform/runtime/lib/composition/application-services.ts:55` | PASS |
| CompatibilityMissionStore unreachable from production | `grep -r "CompatibilityMissionStore" src/platform/runtime/lib/composition/application-services.ts` returns empty | PASS |
| Preflight import gate blocks on conflicts | `test/e2e-mission-sqlite-cutover.test.ts`, `"preflight blocks cutover when import has validation errors"` | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/domain/mission.ts`, `src/domain/checkpoint.ts`, `src/domain/review.ts`, `src/domain/net-engineering-lines.ts` — domain types are not modified; the cutover changes persistence, not the domain model.
- `src/application/domain-ports.ts` — port interfaces (`MissionStore`, `MissionTransitionStore`) are not modified; both adapters already implement them.
- `src/adapters/sqlite/mission-store.ts` and `src/adapters/sqlite/mission-serialization.ts` — SQLite adapter implementation is not modified (delivered by TASK-2322.04/TASK-2322.06).
- `src/adapters/sqlite/mission-importer.ts` — importer implementation is not modified (delivered by TASK-2322.06).
- `src/application/mission-*.service.ts` — use case implementations are not modified; they already depend on the port interface.
- `backlog/tasks/` task file format and `px draft` creation behavior — intake creation stays with the existing draft command.
- `src/platform/runtime/lib/tools/backlog.ts` — the backlog tooling module is not modified; it remains the intake source reader.

## Stop Rules

- Stop if the import preflight reveals more than 3 unresolved conflicts across the full candidate set that cannot be resolved by re-running the import; escalate to TASK-2322.06 for a fix.
- Stop if `SqliteMissionStore.load()` returns a domain model that fails validation in more than one use case; the serialization mismatch must be fixed in TASK-2322.04/TASK-2322.06 before proceeding.
- Stop if the composition-root change requires modifying a domain type or port interface; this is a wiring-only cutover, not a domain redesign.
- Stop if `./scripts/verify-local.sh all` fails on the final tree and the failure is in a file not touched by this mission; the failure is a pre-existing issue.
- Stop if SQLite unavailability causes a command path to silently fall back to file I/O instead of failing; this violates ADR 0053 rule 5 (database unavailability fails closed).
