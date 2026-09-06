# CP-3: Weekly series over the web transport and into FLOW

## Summary

- `src/interfaces/web/transport.ts`: `WebBoardMetrics` gained the optional
  `weeklyCumulativeFlow` (series plus its `window` label and bounds).
  `toWebMetrics` copies the projection's points and window verbatim, and
  `checkMetrics` validates the new member — including the window object — while
  keeping it optional so a projection cached before TASK-2459 still validates.
- `web/src/flow-panel.tsx`: `CumulativeFlow` now draws
  `metrics.weeklyCumulativeFlow ?? metrics.cumulativeFlowByState` as published.
  The client-side `flowWindow` date filter is gone, so the browser no longer
  re-derives the reporting window, subtracts, or infers lane movement. The
  panel heading reads the label off the published weekly window and falls back
  to `RECORDED HISTORY` when the projection published no week — it never labels
  a historical stock with a week it is not charting.
- `test/web-board-render.test.ts`: the TASK-2435 test that asserted client-side
  window filtering was rewritten onto the server-owned contract, and transport,
  render, and source-scan coverage added.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Web transport carries the weekly series and window unchanged | `"the web transport carries the weekly cumulative-flow series and its window unchanged"` in `test/web-board-render.test.ts` | PASS |
| Transport stays valid for a projection without a weekly series | `"a snapshot without a weekly series is still a valid transport payload"` | PASS |
| FLOW renders the published weekly values, not the historical stock | `"FLOW charts the server-owned weekly series and never the historical stock beside it"` | PASS |
| Rendered FLOW uses every published point with no client-side rebasing | `"FLOW draws every published weekly point without rebasing or inferring lane movement"` (asserts 7 published points per lane band and zero `done` thickness where the projection published `done: 0`) | PASS |
| No client-side rebasing or lifecycle inference in the browser sources | `"the browser never filters, rebases, or infers the weekly flow it renders"` scans `web/src/flow-panel.tsx` | PASS |
| Pre-window completion still excluded end to end | `test/task-2459-repro.test.ts` passes | PASS |
| Types compile | `npx tsc --noEmit` clean | PASS |

Next action: CP-4 — run the mission gates `npm test -- --unit-test-headroom`
and `./scripts/verify-local.sh static-analysis`, then record
criterion-by-criterion evidence in `missions/task-2459/CP-4.md`.
