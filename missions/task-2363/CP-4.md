# CP-4 — Windowed cohorts and read adapter

## Summary

The board's `BoardMetrics` now reaches FLOW already windowed.

- `src/application/projections/cohorts.ts`: `CohortComparisonInput.window`
  restricts the comparison to missions completed inside a decision window.
  `compareCohorts` applies it with the CP-3 `outcomesCompletedInWindow` helper —
  the same selector the metric series use — and leaves `input.transitions`
  whole, so a selected member's dwell and review passage still come from its full
  lifecycle.
- `src/application/projections/metrics-read-adapter.ts`: `buildMetrics()` reads
  its clock **once** into `asOf`, derives `weeklyDecisionWindows(asOf)` from it,
  and passes the windows to `buildMetrics()` and `decisionWindows.current` to
  `compareCohorts()`. The board therefore cannot report a decision window that
  disagrees with the instant it was evaluated at.

Existing tests updated for the intended semantic change (no production
workaround, no assertion weakened):

- `test/task-2357-certification.test.ts` — `task-107` is deliberately seeded as a
  previous-week completion. It is now correctly outside the current cohort:
  `ai_sdlc` n 5 → 4, its `reviewFixRounds` observations 4 → 3, and n=4 is below
  the five-mission comparability threshold so `lowSamplePopulation` is now true.
  `readOutcomes()` is unwindowed and still returns all 7 completed missions.
- `test/task-2347.09-cohort-presentation.test.ts` and
  `test/task-2347.08-own-statistics-semantics-repro.test.ts` pinned their
  projection clock beside their fixed fixture dates; they previously relied on
  wall-clock time.
- `test/fixtures/metrics-adapter.ts` gained an optional `clock` argument and a
  comment stating why a dated fixture must pin it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC07 — default FLOW cohort holds only current-window missions | `"excludes a six-month-old mission carrying the same experiment label"` in `test/task-2363-windowed-cohorts.test.ts` asserts n=1 and runtime 30 (a cumulative cohort reports 465) | PASS |
| Adapter derives the window from its injected clock | `"reports the decision windows from the adapter clock, not wall-clock time"` asserts `2026-08-05 → 2026-08-11` and `2026-07-29 → 2026-08-04` | PASS |
| `BoardMetrics` reflects the windowed population through the real SQLite path | same test — `ConcreteMetricsReadAdapter` over `withStatisticsDatabase` in `test/fixtures/task-2357-statistics-fixture.ts` | PASS |
| SC14 through the production adapter | same test asserts `cycleTime.value` 2880 for a mission that entered backlog on 2026-08-04, before the window opened | PASS |
| Cohort restriction reuses one selector, no parallel implementation | `compareCohorts` calls `outcomesCompletedInWindow` from `src/application/projections/metrics.ts` | PASS |
| No regression in the TASK-2357 certification or cohort suites | `test/task-2357-certification.test.ts`, `test/task-2347.09-cohort-presentation.test.ts`, `test/task-2347.09-cohort-metrics.test.ts`, `test/board-metrics.test.ts`, `test/board-projections.test.ts`, `test/metric-contract.test.ts`, `test/tui-flow-panel.test.ts` — 106 pass, 0 fail | PASS |
| Static analysis clean | `npx eslint src/ --max-warnings 300` and `npx tsc --noEmit` both exit 0 | PASS |

Next action: CP-5 — render `metrics.decisionWindow` in `src/interfaces/tui/flow-panel.tsx` as a current/previous comparison with `n` per figure, and visually separate it from the current-state operational block, with no calculation added to React.
