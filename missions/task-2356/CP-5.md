# CP-5 — FLOW cohort presentation

## Work summary

FLOW now renders the existing BoardMetrics cohort comparison directly. It displays cohort population separately from the coverage of cycle time, review dwell, review bounce, runtime, and cost, and uses the same values in wide and narrow layouts. The component performs formatting only.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| FLOW consumes the cohort comparison supplied by BoardMetrics | `src/interfaces/tui/flow-panel.tsx:32`, `src/application/projections/board.ts:146` | PASS |
| FLOW exposes experiment lifecycle, review, usage/cost, and metric coverage | `src/interfaces/tui/flow-panel.tsx:41`, "FLOW panel renders supplied cohort values with metric-specific coverage in wide and narrow layouts" | PASS |
| Wide and narrow FLOW layouts preserve cohort values and coverage | "FLOW panel renders supplied cohort values with metric-specific coverage in wide and narrow layouts" | PASS |
| Presentation does not calculate cohort statistics | `src/interfaces/tui/flow-panel.tsx:32` | PASS |
| Projection-wide population is not presented as each metric's coverage | `src/interfaces/tui/flow-panel.tsx:75`, "FLOW panel visibly labels unavailable and partial health without treating population as metric coverage" | PASS |
| FLOW rendering regression passes | `npx tsx --test test/tui-flow-panel.test.ts` | PASS |

Next action: run the mission gate and record final certification evidence.
