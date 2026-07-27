# CP-2 — projection-owned FLOW data

Extended `BoardMetrics` with state-count cumulative flow, per-state cycle-time rows, weekly throughput, lane median ages, availability rows, and a named-input bottleneck narrative. `buildMetrics()` derives every new value from transitions, outcomes, and materialized agent availability; empty history retains declared fallbacks and the fixed unavailable narrative. Ink rendering is intentionally deferred to CP-3. Focused unit tests use fixed timestamps and assert the exact narrative, unavailable agent state, and zero-history values.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| FLOW values originate in `BoardMetrics`, not component arithmetic | `src/application/projections/board.ts:102`; `src/application/projections/metrics.ts:323` | Complete |
| Declared missing-history fallback remains authoritative | `src/application/projections/metrics.ts:155`; `"FLOW projection reports explicit missing history without fabricated values"` in `test/board-metrics.test.ts` | Complete |
| Lane age and agent availability have projection homes | `src/application/projections/metrics.ts:257`; `src/application/projections/board.ts:110` | Complete |
| Bottleneck narrative is projection-owned and deterministic | `src/application/projections/metrics.ts:280`; `"FLOW projection derives lane rows, agent availability, and a deterministic bottleneck sentence"` in `test/board-metrics.test.ts` | Complete |
| Narrow and resized rendering have an established Ink harness | `src/interfaces/tui/board-layout.tsx:54`; `test/tui-responsive-layout.test.ts` | CP-3 pending |
| Zero-history rendering starts from explicit projection fallbacks | `src/application/projections/metrics.ts:291`; `"FLOW projection reports explicit missing history without fabricated values"` in `test/board-metrics.test.ts` | Projection complete; UI CP-3 pending |
| Component tests assert visible semantics | `test/tui-shell-component.test.ts` | CP-3 pending |
| Headless and non-TTY isolation paths remain separate | `src/interfaces/tui/ui-command.ts:154`; `test/tui-headless-isolation.test.ts` | Preserve in CP-3 |
| Required gates are declared | `./scripts/verify-local.sh all`; `./scripts/verify-local.sh static-analysis` | Pending final checkpoint |

Next action: add the FLOW Ink component and compose it into `BoardShell` with a textual narrow/resized representation.
