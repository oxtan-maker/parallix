# CP-2 — Compose board and TUI capabilities

Moved concrete board-projection and mission-detail construction to `src/composition/board-projection.ts`. The application factory now assembles only supplied application read ports. The TUI accepts an application-owned `TuiCapabilities` contract and no longer resolves operator state, imports adapters, or builds projection collaborators. The runtime entry composes the TUI capability once from the existing production service graph and passes its shared active port. The eight resolved application/TUI allowlist records were removed; TASK-2332.03 entries and unresolved adapter/runtime entries remain untouched.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 concrete board graph is constructed under composition | `src/composition/board-projection.ts:24`; `"composeBoardProjection wires all eight adapters into BoardProjectionBuilder"` | Complete for board graph |
| SC2 TUI receives a capability contract without forbidden imports | `src/interfaces/tui/ui-command.ts:1`; `src/application/tui-capabilities.ts:7`; `"TUI command receives application capabilities and imports no composition or adapter module"` | Complete |
| SC3 legacy lifecycle injection | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:209` | Pending CP3 |
| SC4 one operator database lifecycle | `src/platform/runtime/lib/composition/application-services.ts:139`; `src/adapters/sqlite/adapter-factory.ts:74` | Pending explicit lifecycle test |
| SC5 shared CLI/TUI capability identity | `src/platform/runtime/index.ts:73`; `src/platform/runtime/lib/composition/application-services.ts:177` | Pending identity test |
| SC6 resolved allowlist edges are removed and boundaries are covered | `src/platform/runtime/lib/architecture/dependency-graph-allowlist.ts:9`; `"TUI command receives application capabilities and imports no composition or adapter module"` | Partial; adapter/runtime edges remain |
| SC7 board projection and TUI interaction characterization holds | `"BoardProjectionBuilder is wired in composition root over all six concrete adapters"`; `"confirmed action dispatches through supplied controller and conflict refreshes before re-prompting"` | Complete for CP2 paths |
| SC8 focused verification completed | `npx tsc --noEmit --pretty false`; `test/tui-command-guardrail.test.ts` | Partial; required gates pending CP4 |

Next action: inject `MissionTransitionStore` into `LegacyActiveAdapter`, make the production service graph reuse it for the active lifecycle, and add a mocked test that proves database lifecycle and shared CLI/TUI capability identity.
