# CP-1 — flow analytics design inventory

Inspected the existing `BoardMetrics` projection, TASK-2303's typed `MissionTransition` contract, the metrics read adapter, and the Ink board shell/layout test harness. The current four scalar metric series need projection-owned additions for state-count flow points, per-lane cycle/age rows, agent availability, and a named-input bottleneck narrative. The FLOW surface will be a dedicated Ink component composed by `BoardShell`; it will use the existing `useTerminalDimensions` resize subscription and component test fake stdout pattern. No history write-path or lifecycle behavior is in scope.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| FLOW values originate in `BoardMetrics`, not component arithmetic | `src/application/projections/board.ts:69`; `src/application/projections/metrics.ts:206` | Inspected; implementation next |
| Declared missing-history fallback remains authoritative | `src/application/projections/board.ts:39`; `test/board-metrics.test.ts` | Inspected; implementation next |
| Lane age and agent availability have projection homes | `src/application/projections/agent-status.ts:3`; `src/application/projections/board-readers.ts:44` | Inspected; implementation next |
| Bottleneck narrative is projection-owned and deterministic | `src/application/projections/metrics.ts:206`; `test/board-metrics.test.ts` | Inspected; implementation next |
| Narrow and resized rendering have an established Ink harness | `src/interfaces/tui/board-layout.tsx:54`; `test/tui-responsive-layout.test.ts` | Inspected; implementation next |
| Zero-history rendering starts from explicit projection fallbacks | `src/application/projections/board-readers.ts:190`; `test/tui-shell-component.test.ts` | Inspected; implementation next |
| Component tests assert visible semantics | `test/tui-shell-component.test.ts` | Inspected; implementation next |
| Headless and non-TTY isolation paths remain separate | `src/interfaces/tui/ui-command.ts:154`; `test/tui-headless-isolation.test.ts` | Inspected; preserve |
| Required gates are declared | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | Pending final checkpoint |

Next action: extend `BoardMetrics` and `buildMetrics()` with deterministic FLOW-specific projection fields before composing the Ink panel.
