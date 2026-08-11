# CP-5 — FLOW presentation

## Summary

`src/interfaces/tui/flow-panel.tsx` now presents FLOW as a weekly decision
surface. It formats only: every figure is read straight off `BoardMetrics`.

- Header names the window: `FLOW · decision window 2026-08-05 → 2026-08-11`.
- New `DecisionWindowRows` block — `DECISION WINDOW · completed missions` — with
  a `current`/`previous` column pair for completed missions, lifecycle cycle
  median, agent runtime median, active/review/integration dwell medians, and
  review bounce rate. Each cell carries its own `(n=…)`. It degrades to a stated
  "decision window unavailable" line for a projection cached before this change,
  rather than silently showing nothing.
- Narrow (<80 column) layout folds each row to
  `<label>: <current> · previous <previous>` instead of the padded columns.
- Current-state metrics are now under an explicit `CURRENT FLOW · state now`
  heading (median lane age) and the `CUMULATIVE FLOW` column (lane occupancy,
  weekly completions, bottleneck, agent availability), separated from the
  completed-mission decision block.
- The provenance line is no longer readable as the decision sample:
  `Statistics: healthy · population n=299 (all recorded history, not the decision
  sample)`.
- `EXPERIMENT COHORTS` names the window it was computed over.
- Two pure formatters added: `figure()` (value + `(n=…)`) and `rateFigure()`
  (a rate to two decimals). No filtering, sorting, reducing, or date arithmetic
  exists in the file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC09 — FLOW displays the current rolling-7-day date range | `"shows the current rolling-7-day date range in the header"` in `test/task-2363-flow-presentation.test.ts` | PASS |
| AC02 — previous window exposed for comparison | `"shows the previous window beside the current one"` | PASS |
| SC10 — actual observation count `n` per decision metric | `"shows the observation count for each main decision metric"` asserts `Completed missions n=31 n=28`, `Lifecycle cycle median 40 min (n=31) 140.5 min (n=28)`, `Agent runtime median 15 min (n=11)`, `Review bounce rate 0.16 (n=31) 1.00 (n=28)` | PASS |
| Lifetime population not presented as the decision sample | `"does not present the all-history population as the decision sample"` | PASS |
| SC08 — operational metrics visually distinguishable | `"separates current-state flow from completed-mission decision metrics"` asserts both headings exist and are ordered | PASS |
| Narrow layout keeps every figure and its comparison | `"keeps every decision figure readable in the narrow layout"` | PASS |
| SC29 / AC37 — no statistics calculation in React | `"calculates no statistics in the panel"` scans `src/interfaces/tui/flow-panel.tsx` for `.filter(`, `.sort(`, `.reduce(`, `Date.parse`, `setUTCDate` | PASS |
| No regression in the existing FLOW / board TUI suites | `test/tui-flow-panel.test.ts`, `test/tui-command-flow.test.ts`, `test/board-controller.test.ts`, `test/board-projections.test.ts` — all pass | PASS |
| Static analysis clean | `npx eslint src/ --max-warnings 300` and `npx tsc --noEmit` exit 0 | PASS |

Next action: CP-6 — make new measurement writes use the canonical repository id in `resolveStatsRepoName` (`src/adapters/cli/commands/stats.ts`), keeping `product.name` only as an explicit read-side legacy alias, and re-audit `reviewFixRounds` producers for `?? '0'` defaults.
