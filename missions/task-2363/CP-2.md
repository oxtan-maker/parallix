# CP-2 — Shared decision-window primitive

## Summary

Extracted the rolling seven-day decision-window semantics out of the CLI adapter
into the application layer, and made every existing caller read that one owner.

- Added `src/application/services/decision-window.ts`: `DecisionWindow`,
  `DecisionWindows`, `decisionWindowEndingOn`, `weeklyDecisionWindows`,
  `decisionWindowContains`, `decisionWindowDay`, `DECISION_WINDOW_DAYS`.
  `DecisionWindow extends ReportingWindow`, so it is directly accepted by the
  existing `statisticsRowInWindow` / `summarizeCompletedMissionWindow` helpers.
  It carries `startDate`/`endDate` (`YYYY-MM-DD`) and a `label` in the
  `2026-08-05 → 2026-08-11` form the operator reads.
  Containment is by UTC calendar day, so a mission that closed at 14:00 on the
  last day of the window is inside it — the CLI's midnight-instant `end` alone
  would have excluded it.
- `src/adapters/cli/commands/stats.ts`: `createWindow` and `buildWeeklyWindows`
  now delegate to the application primitive. The local `addDays` helper became
  dead and was removed; the pre-existing unused `path` import on the same file
  was removed so the changed file lints clean.
- `src/application/stats-command-use-case.ts`: deleted its private `weeklyWindow`
  and `dateOnly` duplicates; weekly mode now calls
  `weeklyDecisionWindows(today).current`.
- `src/application/projections/cohorts.ts`: `observationCounts.reviewFixRounds`
  was declared `number | null` while the implementation always produced a number.
  The dead `| null` was the cause of the repository's only pre-existing
  `tsc --noEmit` error (`src/adapters/cli/commands/cohort-report.ts(48,43)`), so
  it was narrowed to `number` with a comment stating why it is never null.

No behavior change to `px stats`: the same four date values are produced by the
same arithmetic, only from one place.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC01 — `weeklyWindow()` current-window logic extracted to the application layer | `src/application/services/decision-window.ts`, test `"returns current and previous non-overlapping 7-day ranges"` | PASS |
| SC02 — previous non-overlapping window defined in the same primitive | `"returns current and previous non-overlapping 7-day ranges"` asserts `2026-07-29 → 2026-08-04` for today `2026-08-11` | PASS |
| Primitive imported by the CLI use case and the CLI adapter | `src/application/stats-command-use-case.ts` and `src/adapters/cli/commands/stats.ts` both import `weeklyDecisionWindows`; no seven-day arithmetic remains in either | PASS |
| Window labels available for presentation | `"labels each window with its inclusive date range"` | PASS |
| Containment accepts a full completion instant, not just a date | `"contains a completion at any time on the last day"` | PASS |
| Behavior-preserving for the CLI's date-only comparison | `"stays compatible with the date-only telemetry comparison px stats uses"` | PASS |
| SC16 — default `px stats` weekly output unchanged | `test/stats.test.ts`, `test/stats-report.test.ts`, `test/stats-command-use-case.test.ts`, `test/stats-command-routing.test.ts`, `test/task-2347.08-own-statistics-semantics-repro.test.ts`, `test/mission-phase-stats.test.ts`, `test/review-stats.test.ts`, `test/stats-active-breakdown.test.ts`, `test/stats-backfill.test.ts` — 124 pass, 0 fail | PASS |
| Static analysis clean on changed files | `npx eslint src/adapters/cli/commands/stats.ts` clean; `npx tsc --noEmit` exits 0 (previously reported one error) | PASS |

Next action: CP-3 — add the decision-window parameter to `medianStateTimes`, `medianAgentRuntime`, `medianCycleTimeByStateSeries` and `reviewBounceRateSeries` in `src/application/projections/metrics.ts`, selecting missions by `closedAt` and using their full lifecycle intervals, so `test/task-2363-weekly-decision-window.test.ts` turns green.
