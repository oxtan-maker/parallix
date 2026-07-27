# CP-3 — Ink FLOW panel and responsive text rendering

Added `FlowPanel` and composed it into `BoardShell`. The component consumes `BoardMetrics` only, renders all FLOW labels and projection values, prints each series fallback verbatim, shows explicit available/unavailable agent states, and displays the projection-owned bottleneck sentence. At widths below 80 columns—and after the live stdout resize event—it switches to a one-column textual representation while retaining labels and values. Focused component coverage is non-snapshot based and runs through Ink's headless string renderer and a fake TTY resize stream.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| FLOW values originate in `BoardMetrics`, not component arithmetic | `src/interfaces/tui/flow-panel.tsx:32`; `src/application/projections/metrics.ts:323` | Complete |
| Declared missing-history fallback remains authoritative | `src/interfaces/tui/flow-panel.tsx:44`; `"FLOW panel states every fallback and survives a zero-history projection"` in `test/tui-flow-panel.test.ts` | Complete |
| Lane age and agent availability have projection homes | `src/interfaces/tui/flow-panel.tsx:47`; `src/interfaces/tui/flow-panel.tsx:54` | Complete |
| Bottleneck narrative is projection-owned and deterministic | `src/application/projections/metrics.ts:280`; `"FLOW projection derives lane rows, agent availability, and a deterministic bottleneck sentence"` in `test/board-metrics.test.ts` | Complete |
| Narrow and resized rendering have an established Ink harness | `src/interfaces/tui/flow-panel.tsx:34`; `"FLOW panel switches to textual layout at narrow width and after a resize"` in `test/tui-flow-panel.test.ts` | Complete |
| Zero-history rendering starts from explicit projection fallbacks | `src/interfaces/tui/flow-panel.tsx:45`; `"FLOW panel states every fallback and survives a zero-history projection"` in `test/tui-flow-panel.test.ts` | Complete |
| Component tests assert visible semantics | `"FLOW panel renders projection labels, values, unavailable agent, and bottleneck sentence"` in `test/tui-flow-panel.test.ts` | Complete |
| Headless and non-TTY isolation paths remain separate | `src/interfaces/tui/ui-command.ts:154`; `test/tui-headless-isolation.test.ts` | Focused test passed; final gates pending |
| Required gates are declared | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | Pending CP-4 |

Next action: run the repository verification gates, capture durable evidence, and record that TASK-2303's write path and TASK-2309 invocation defaults remain untouched.
