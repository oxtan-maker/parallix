# CP-1: Extract stats normalization and windowing

Created `stats-normalization.ts` as the shared leaf module for stats-row
normalization, date parsing, time windows, classification handling, and
accumulation. `stats.ts` retains the established public surface by importing
and re-exporting the extracted symbols, while `stats-report-rendering.ts`
consumes its moved report-normalization helpers from the new module. No tests
or caller import paths changed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| stats.ts is below 1400 lines | `./scripts/verify-local.sh static-analysis`; `test/stats.test.ts` | PASS |
| Shared normalization helpers have a leaf module | "task-1251 and task-1314: normalizeStatsRow migrates a legacy 5-column row to the 21-column schema", `test/stats.test.ts` | PASS |
| Existing stats-module exports remain available | "task-1251 and task-1314: normalizeStatsRow migrates a legacy 5-column row to the 21-column schema", `test/stats.test.ts` | PASS |
| Report rendering uses the shared normalization module | "renderWeeklyStatsReport produces current and previous week sections", `test/stats-report.test.ts` | PASS |
| Stats behavior remains covered without test edits | "buildWeeklyWindows returns two week windows", `test/stats-report.test.ts` | PASS |
| Required static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Commit CP-1 and the completed extraction, then hand off the fully gated mission because CP-1 is its only declared checkpoint.
