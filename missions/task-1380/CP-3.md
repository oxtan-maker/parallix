# CP-3: Reporting

## Summary

Updated three reporting functions to filter by `closed === 'yes'`:

1. **`summarizeMissionWindow`** (`lib/commands/stats.ts:820`) — Added `closedRows = windowRows.filter(row => row.closed === 'yes')` before deduplication and counting. Returns `rows: closedRows` instead of `rows: windowRows`.

2. **`summarizeAgentWindow`** (`lib/commands/stats.ts:880`) — Added `closedWindowRows = windowRows.filter(row => row.closed === 'yes')` before classification filtering and agent grouping.

3. **`renderMissionPhaseReport`** (`lib/commands/stats.ts:1135`) — Added `row.closed === 'yes'` to the mission row filter condition.

## Goal Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC3: summarizeMissionWindow filters non-closed rows | PASS | test `task-1380: summarizeMissionWindow excludes non-closed rows` at `test/stats-task-1380-closed-filter.test.js:58` — asserts `result.total === 1` with mixed closed/in-progress rows |
| SC4: renderWeeklyStatsReport excludes in-progress | PASS | test `task-1380: renderWeeklyStatsReport excludes in-progress missions` at `test/stats-task-1380-closed-filter.test.js:81` — asserts current week = 1, previous week = 0 |
| SC5: renderRangeStatsReport filters by closed | PASS | test `task-1380: renderRangeStatsReport excludes in-progress missions` at `test/stats-task-1380-closed-filter.test.js:99` — asserts mission count = 1, user_value = 1, ai_sdlc = 0 |

## Next action
Run CP-4: Execute all existing tests to verify no regressions, then run `./scripts/verify-local.sh all`.
