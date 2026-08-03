# CP-3 — Inject active lifecycle authority

Removed `LegacyActiveAdapter`’s import and runtime lookup of `createMissionApplicationServices()`. Composition constructs the Mission services before the active adapter, supplies its selected `MissionTransitionStore` explicitly, and exposes the one active port that both CLI service construction and TUI capability construction share. The existing operator-state singleton remains the process-level open/migrate cache and its cache-clearing close operation remains the shutdown/test lifecycle owner.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 concrete adapter construction is outside application; moving `BoardProjectionBuilder` construction remains for CP4 | `src/composition/board-projection.ts:34`; `src/application/projections/create-board-projection-builder.ts` | Partial; completed in CP4 |
| SC2 TUI consumes constructed capabilities | `src/interfaces/tui/ui-command.ts:13`; `src/platform/runtime/index.ts:73` | Complete |
| SC3 legacy lifecycle uses injected authority, not service location | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:24`; `"legacy active adapter uses the injected mission transition store identity"` | Complete |
| SC4 database open/migrate/share/close owner remains explicit | `src/adapters/sqlite/adapter-factory.ts:74`; `src/adapters/sqlite/adapter-factory.ts:125` | Partial; final lifecycle characterization pending |
| SC5 active capability identity is shared by production composition | `src/platform/runtime/lib/composition/application-services.ts:184`; `src/platform/runtime/index.ts:86` | Partial; final CLI/TUI identity characterization pending |
| SC6 TUI and application forbidden construction edges stay removed | `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:9`; `"TUI command receives application capabilities and imports no composition or adapter module"` | Partial |
| SC7 active lifecycle order is retained | `"legacy active adapter preserves the launch-synchronize-stats-handoff lifecycle order"` | Complete |
| SC8 focused type and lifecycle verification completed | `npx tsc --noEmit --pretty false`; `test/legacy-active-adapter.test.ts` | Partial; required gates pending CP4 |

Next action: run dependency-boundary and full characterization coverage, remove any remaining resolved TASK-2332.02 allowlist records, execute `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all`, then record final evidence.
