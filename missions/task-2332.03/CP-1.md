# CP-1 — Contract inventory and ownership map

Inventoried every declaration in `src/adapters/sqlite/ports.ts` and its
application consumers. The application-owned contracts are mapped as follows:

| Capability | Contracts to own |
|---|---|
| `mission-store.ts` | `SessionMarkerEntry`, `SessionMarkerWrite`, `SessionMarkerRepository` |
| `mission-measurements.ts` | `UsageRecord`, `UsageRepository` |
| `operator-preferences.ts` | `UIPreferenceEntry`, `UIPreferencesRepository` |
| `repository-catalog.ts` | `KnownRepositoryEntry`, `KnownRepositoriesRepository` |
| `agent-blocklist.ts` | `AgentBlockEntry`, `AgentBlocklistRepository` |
| `operation-history.ts` | `OperationalHistoryEntry`, `OperationalHistoryRepository`, `BoardLaneEventEntry`, `BoardLaneEventRepository` |

`MigrationLedgerEntry`, `MigrationLedgerRepository`, and `ImportRecord` are
SQLite-private migration/import mechanics. The mission aggregate contracts and
measurement-store contract were already application-owned and are not moved.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Each application capability has a classified target | `src/adapters/sqlite/ports.ts:42`, `src/adapters/sqlite/ports.ts:118`, `src/adapters/sqlite/ports.ts:172`, `src/adapters/sqlite/ports.ts:223`, `src/adapters/sqlite/ports.ts:273`, `src/adapters/sqlite/ports.ts:385`, `src/adapters/sqlite/ports.ts:458` | PASS |
| Migration and import mechanics stay adapter-private | `src/adapters/sqlite/ports.ts:299`, `src/adapters/sqlite/ports.ts:327`, ADR 0051 | PASS |
| Application consumers requiring replacement are identified | `src/application/services/agent-block-service.ts:1`, `src/application/services/known-repository-service.ts:2`, `src/application/projections/metrics-read-adapter.ts:1` | PASS |
| Existing application-owned contracts are not relocated | `src/application/domain-ports.ts`, `src/application/measurement-ports.ts:72` | PASS |

Next action: create the six capability files, relocate the classified application contracts, and redirect application imports.
