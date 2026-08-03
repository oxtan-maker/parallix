# CP-4 — Verify the production composition boundary

Completed the production board/TUI composition extraction and the legacy active lifecycle injection. Concrete board projection, `BoardProjectionBuilder`, and mission-detail collaborators are now constructed in `src/composition/board-projection.ts`; application and TUI code consume port/capability contracts. The production graph creates its Mission authority before its active adapter, supplies the exact transition store explicitly, exposes one shared CLI/TUI presentation-capability object, and registers one idempotent operator-state close path for process shutdown. The resolved application/TUI allowlist records were removed, preserving TASK-2332.03 records and the unrelated legacy adapter/runtime migration records. The accidental `package-lock.json` change was reverted.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 all board projection collaborators, including `BoardProjectionBuilder`, are constructed by composition | `src/composition/board-projection.ts:34`; `test/adapters/single-path-guardrail.test.ts`; `"SC1: BoardProjectionBuilder construction is limited to src/composition/"` | Complete |
| SC2 TUI imports only application contract/UI code and receives production capabilities | `src/interfaces/tui/ui-command.ts:1`; `src/application/tui-capabilities.ts:7`; `"TUI command receives application capabilities and imports no composition or adapter module"` | Complete |
| SC3 legacy adapter does not locate Mission services and uses injected transition authority | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:24`; `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:145`; `"legacy active adapter uses the injected mission transition store identity"` | Complete |
| SC4 operator SQLite uses one cached open/migrate lifecycle with explicit close operation | `src/composition/operator-state-lifecycle.ts:15`; `src/adapters/sqlite/adapter-factory.ts:151`; `"clearOperatorStateCacheSync closes initialized cached adapters for process exit"` | Complete |
| SC5 CLI and TUI use the board reads and active port from the same production graph | `src/composition/production-capabilities.ts:34`; `src/platform/runtime/lib/composition/application-services.ts:194`; `"production composition gives CLI and TUI identical board and active capability instances"` | Complete |
| SC6 resolved TASK-2332.02 allowlist records are removed and prohibited TUI/application edges are tested | `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:9`; `test/tui-command-guardrail.test.ts`; `"application import guard accepts every file under src/application/"` | Complete for resolved construction edges |
| SC7 board, TUI, and active lifecycle characterization contracts remain intact | `"BoardProjectionBuilder is wired in composition root over all six concrete adapters"`; `"confirmed action dispatches through supplied controller and conflict refreshes before re-prompting"`; `"legacy active adapter preserves the launch-synchronize-stats-handoff lifecycle order"` | Complete |
| SC8 required gates pass with no skipped tests added | `./scripts/verify-local.sh static-analysis`; `./scripts/verify-local.sh all` | Complete |

Next action: Parallix can inspect the committed checkpoint and gate evidence for lifecycle handoff; no review or integration command was run by this mission.
