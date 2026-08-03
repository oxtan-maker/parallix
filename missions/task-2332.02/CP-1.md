# CP-1 — Map composition boundary and lifetime ownership

Mapped the TASK-2332.02 allowlist entries to their construction sites and callers. The board factory in `src/application/projections/create-board-projection-builder.ts` constructs six concrete backlog adapters and the metrics adapter; `src/interfaces/tui/ui-command.ts` imports that factory and additionally constructs `ConcreteMissionReadAdapter`/`MissionProjectionQuery` after dynamically resolving runtime composition. `LegacyActiveAdapter` service-locates `createMissionApplicationServices()` through its default runtime. The in-scope adapter-to-runtime entries are retained for the later extraction of backlog/runtime behavior; the two application-to-SQLite-port entries remain owned by TASK-2332.03.

The implementation seam is a composition-owned production capability object: it will own the board builder, mission-detail query, active command-controller factory, operator-state ports, and close hook. Application code will retain only a factory over supplied read ports; the TUI will accept the capability contract; and the legacy adapter will receive a narrow `MissionTransitionStore` dependency from composition. The single operator-state initializer will be retained as the one open/migrate/share/close owner for the CLI process.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 board construction target is identified | `src/application/projections/create-board-projection-builder.ts:1`; `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:11` | Planned |
| SC2 TUI construction and forbidden imports are identified | `src/interfaces/tui/ui-command.ts:1`; `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:32` | Planned |
| SC3 lifecycle service-location removal target is identified | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:7`; `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:209` | Planned |
| SC4 shared operator database owner is identified | `src/platform/runtime/lib/composition/application-services.ts:138`; `src/platform/runtime/lib/composition/application-services.ts:197` | Planned |
| SC5 identity characterization seam is identified | `test/tui-command-flow.test.ts`; `test/legacy-active-adapter.test.ts` | Planned |
| SC6 in-scope allowlist removal set is recorded | `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:11`; `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:33` | Planned |
| SC7 existing behavior coverage is located | `"legacy active adapter preserves the launch-synchronize-stats-handoff lifecycle order"`; `test/tui-command-flow.test.ts` | Existing coverage located |
| SC8 final required gates are recorded | `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | Pending CP4 |

Next action: create `src/composition/production-capabilities.ts`, reduce `create-board-projection-builder.ts` to an injected-port application factory, and route `ui-command.ts` through that capability contract.
