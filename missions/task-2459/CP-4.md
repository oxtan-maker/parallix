# CP-4: Gates and criterion-by-criterion evidence

## Summary

Ran both mission gates against the committed tree and recorded evidence for
every success criterion. One fix landed in this checkpoint: the reproduction
test used `trigger: 'draft'`, which is not a `MissionCommand['type']`; the test
typecheck stage of the static-analysis gate caught it and it is now
`trigger: 'refine'`. The Backlog task's acceptance and definition-of-done
checkboxes were ticked (content only; no status, assignee, label, or lifecycle
metadata changed).

Gate results:

- `npm test -- --unit-test-headroom` — exit 0, `tests 2401 / pass 2401 / fail 0`.
- `./scripts/verify-local.sh static-analysis` — `ALL STAGES PASSED` (ESLint,
  `npm run typecheck`, test-hygiene, test typecheck).

Shape of the change: `weeklyCumulativeFlowByStateSeries` in
`src/application/projections/metrics.ts` derives the week from the same
recorded transitions the historical series uses, `decisionWindowDays` in
`src/application/services/decision-window.ts` enumerates the window's days,
`BoardMetrics.weeklyCumulativeFlow` publishes it, `src/interfaces/web/transport.ts`
carries it, and `web/src/flow-panel.tsx` draws it as published.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A board snapshot publishes a cumulative-flow series with an explicit current seven-day inclusive UTC window label and bounds, derived using the injected clock | `"weeklyCumulativeFlowByStateSeries scopes the series to the window days and label"` and `"buildMetrics publishes the weekly series on the same window as the decision metrics"` in `test/board-metrics.test.ts` | PASS |
| For a mission completed before that window, every published weekly point excludes it from `done`; the first point starts without its historical completion accumulation | `test/task-2459-repro.test.ts` (`"the weekly cumulative flow series starts without a mission completed before the reporting window"`) and `"weeklyCumulativeFlowByStateSeries leaves a mission completed before the window out of every point"` | PASS |
| A completion recorded within the window affects the corresponding weekly points | `"weeklyCumulativeFlowByStateSeries counts a completion recorded inside the window from that day on"` | PASS |
| A lane transition recorded within the window affects the corresponding weekly points | `"weeklyCumulativeFlowByStateSeries moves a mission between lanes inside the window"` | PASS |
| Missing lifecycle history is represented only by the established unavailable/estimated metric contract | `"weeklyCumulativeFlowByStateSeries reports missing lifecycle history as estimate or skip, never as zeroes"` | PASS |
| `px stats` and the board projection produce the same seven-day inclusive UTC calendar-day bounds for the same injected clock | `"px stats and the weekly FLOW series read the same injected-clock window authority"` in `test/board-metrics.test.ts`; both call `weeklyDecisionWindows` in `src/application/services/decision-window.ts` | PASS |
| The web snapshot transports the weekly series | `"the web transport carries the weekly cumulative-flow series and its window unchanged"` and `"a snapshot without a weekly series is still a valid transport payload"` in `test/web-board-render.test.ts` | PASS |
| FLOW renders those values without subtracting, rebasing, or inferring transitions in the browser | `"FLOW draws every published weekly point without rebasing or inferring lane movement"`, `"FLOW charts the server-owned weekly series and never the historical stock beside it"`, `"the browser never filters, rebases, or infers the weekly flow it renders"` | PASS |
| Focused tests cover pre-window completion, in-window completion, in-window lane transition, missing history, transport, and rendered FLOW output | `test/board-metrics.test.ts`, `test/web-board-render.test.ts`, `test/task-2459-repro.test.ts` | PASS |
| Gate: unit suite | `npm test -- --unit-test-headroom` — exit 0, `tests 2401 / pass 2401 / fail 0` | PASS |
| Gate: static analysis | `./scripts/verify-local.sh static-analysis` — `ALL STAGES PASSED` | PASS |
| No historical lifecycle record altered, backfilled, or fabricated | `weeklyCumulativeFlowByStateSeries` reads `transitions` only; `"weeklyCumulativeFlowByStateSeries reports missing lifecycle history as estimate or skip, never as zeroes"` pins the no-fabrication case | PASS |

Next action: hand off to review — all four checkpoints are committed and both
mission gates pass on the committed tree; a reviewer can reproduce with
`npm test -- --unit-test-headroom` and `./scripts/verify-local.sh static-analysis`.
