# CP-1: Inventory and Application-Port / Shared-Projection Contract

## Summary

Mapped all operator-state authorities, production entry points, and identified every direct-persistence path, in-memory repository, and adapter-specific shortcut targeted for replacement or test confinement in CP-2/CP-3.

### SQLite Repositories (src/adapters/sqlite/)

| Repository | Port | Production Consumer | Status |
|---|---|---|---|
| SqliteMissionStore | MissionStore, MissionNelRecorder | createMissionApplicationServices() | Wired |
| SqliteBlocklistRepository | AgentBlocklistRepository | materializeOperatorState() → blocklist snapshot | Wired |
| SqliteUsageRepository | UsageRepository | createBoardProjectionBuilder() (via status.ts / ui-command.ts) | Partially wired |
| SqliteKnownRepositoriesRepository | KnownRepositoriesRepository | **None** | **Not wired** |
| SqliteUIPreferencesRepository | UIPreferencesRepository | **None** | **Not wired** |
| SqliteOperationalHistoryRepository | OperationalHistoryRepository | ConcreteOperationLogReadAdapter (via createBoardProjectionBuilder) | Partially wired |
| SqliteBoardLaneEventRepository | BoardLaneEventRepository | BoardEventRecorder, SqliteMissionStore (embedded) | Partially wired |
| SqliteSessionMarkerRepository | SessionMarkerRepository | SessionMarkerAdapter | Wired |

### Production Entry Points

| Entry | File | Persistence Access | Issue |
|---|---|---|---|
| CLI main | src/platform/runtime/px.ts → index.ts | Via createProductionApplicationServices() | OK |
| CLI status | src/platform/runtime/lib/commands/status.ts | Opens SQLite independently (createProjectionDeps:119) | Adapter shortcut |
| TUI shell | src/interfaces/tui/ui-command.ts | In-memory stub repos (lines 16-64) | In-memory repos |
| Board projection | src/application/projections/create-board-projection-builder.ts | Receives repos as deps | OK (port contract) |
| Mission services | src/platform/runtime/lib/composition/application-services.ts | Opens SQLite in createMissionApplicationServices() | OK (composition root) |

### Direct Persistence Paths Targeted for Replacement

1. **status.ts:119-145** — `createProjectionDeps()` opens SQLite independently with dynamic imports; must receive repos from composition root
2. **ui-command.ts:16-64** — Four in-memory stub repositories (EmptyBlocklistRepository, EmptyHistoryRepository, EmptyLaneEventRepository, EmptyUsageRepository); must receive real repos from composition root
3. **KnownRepositoriesRepository** — Port and SQLite implementation exist but no application service or projection consumer; needs application behavior for path replacement by RepositoryId
4. **UIPreferencesRepository** — Port and SQLite implementation exist but no production consumer; classified as opaque-operator-setting; needs production wiring with restart persistence
5. **OperationalHistoryRepository** — Used by ConcreteOperationLogReadAdapter but not included in production composition root output
6. **BoardLaneEventRepository** — Embedded in SqliteMissionStore; BoardEventRecorder not in production composition root

### In-Memory / Adapter-Specific Shortcuts Targeted for Removal

1. **ui-command.ts** — EmptyBlocklistRepository, EmptyHistoryRepository, EmptyLaneEventRepository, EmptyUsageRepository (lines 16-64)
2. **status.ts** — Fallback empty repos when SQLite unavailable (lines 139-143)
3. **application-services.ts:138** — Blocklist materialized as in-memory snapshot (by design per ADR 0044, retained)

### Completed Application-Port / Shared-Projection Contract

The `BoardProjectionBuilder` (src/application/projections/board-readers.ts) is the shared projection contract. It receives six read adapters plus a metrics adapter and produces `BoardProjection`. All consumers (CLI status, TUI shell, web-board) must route through this builder. The contract provides:
- **Mission data** via MissionReadAdapter
- **Review state** via ReviewReadAdapter
- **Gate state** via GateReadAdapter
- **Agent availability** via AgentReadAdapter (reads from AgentBlocklistRepository)
- **Git state** via GitReadAdapter
- **Operation log** via OperationLogReadAdapter (reads from OperationalHistoryRepository)
- **Metrics** via MetricsReadAdapter (reads from BoardLaneEventRepository + UsageRepository)

The composition root `createBoardProjectionBuilder()` (src/application/projections/create-board-projection-builder.ts:32) wires concrete adapters. KnownRepository observations and UI preferences are not yet represented in this contract.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| KnownRepository observations persisted/queried by RepositoryId | `src/adapters/sqlite/repository-repository.ts:1` (SqliteKnownRepositoriesRepository), `src/adapters/sqlite/mission-store.ts:196` (saveKnownRepository), `src/adapters/sqlite/mission-store.ts:213` (loadKnownRepository) | PARTIAL |
| UI preferences use checked SQLite in production | `src/adapters/sqlite/ui-preferences-repository.ts:15` (exists), `src/application/persistence-domain-map.ts:104` (classified opaque-operator-setting), no production consumer | PARTIAL |
| LaneTransitionEvent emitted through application behavior | `src/application/recording/board-event-recorder.ts:22` (BoardEventRecorder), `src/adapters/sqlite/mission-store.ts:63` (embedded eventRepo) | PARTIAL |
| Shared projection provides Mission, repository, AgentBlock, preference, history | `src/application/projections/board-readers.ts:78` (BoardProjectionBuilder), `src/application/projections/create-board-projection-builder.ts:32` (composition root) | PARTIAL |
| Production CLI/TUI composition from one root | `src/platform/runtime/lib/composition/application-services.ts:100` (createProductionApplicationServices), `src/interfaces/tui/ui-command.ts:16` (in-memory stubs not from root) | PARTIAL |
| In-memory repos removed or test-confined | `src/interfaces/tui/ui-command.ts:16-64` (4 in-memory stubs), `src/platform/runtime/lib/commands/status.ts:139` (fallback empty repos) | PARTIAL |
| Mocked tests cover required scenarios | `test/sqlite-ports-cp2.test.ts` (existing port tests), no CP-2/CP-3 behavior tests yet | PARTIAL |
| verify-local.sh all passes | `./scripts/verify-local.sh all` on current tree | PASS |

Next action: Implement KnownRepository observation service with RepositoryId identity preservation and path replacement behavior (CP-2).
