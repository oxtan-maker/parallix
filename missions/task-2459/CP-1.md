# CP-1: Reproduction test (red)

## Summary

Added `test/task-2459-repro.test.ts` before any production change. The test
drives `buildMetrics` with an injected clock (`2026-08-31T12:00:00Z`) and the
shared `weeklyDecisionWindows` authority, using a mission whose full lifecycle
(intake, activation, completion) is recorded in July — seven weeks before the
current rolling seven-day UTC window (`2026-08-25 → 2026-08-31`).

It asserts the board projection publishes a weekly cumulative-flow series whose
window label and bounds come from the injected clock, and that the first weekly
point carries `done: 0` — no pre-window completion accumulation.

Observed red against this mission's parent commit (`c71d86c3d`, no production
change yet):

```
✖ the weekly cumulative flow series starts without a mission completed before the reporting window
  AssertionError: the projection must publish a weekly cumulative-flow series
```

Run it with `npx tsx --test test/task-2459-repro.test.ts`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists before production change | `test/task-2459-repro.test.ts` | PASS |
| Test uses an injected clock and the shared window authority | test asserts `weeklyDecisionWindows('2026-08-31T12:00:00Z')` bounds `2026-08-25`/`2026-08-31` in `test/task-2459-repro.test.ts` | PASS |
| Pre-window completion excluded from the first weekly `done` value | `"the weekly cumulative flow series starts without a mission completed before the reporting window"` asserts `counts.done === 0` | RED (expected) |
| Test is red at the parent commit | `npx tsx --test test/task-2459-repro.test.ts` fails with "the projection must publish a weekly cumulative-flow series" | PASS |
| Board projection publishes weekly window label and bounds | `test/task-2459-repro.test.ts` asserts `weekly.window.label` equals the current decision window label | RED (expected) |

Next action: CP-2 — add `weeklyCumulativeFlowByStateSeries` to
`src/application/projections/metrics.ts`, publish it as
`BoardMetrics.weeklyCumulativeFlow`, and cover pre-window completion, in-window
completion, in-window lane movement, and missing history in
`test/board-metrics.test.ts`.
