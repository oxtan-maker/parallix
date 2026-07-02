# CP-2: Schema + Integration

## Summary

Added `closed` column to `STATS_HEADERS` array (now 22 elements), updated `normalizeStatsRow` to default missing `closed` to `'yes'` for backward compatibility, and updated `recordIntegrationStats` to set `closed: 'yes'` on the row passed to `upsertStatsRow`. Also exported `summarizeMissionWindow` in `_internals` for test access.

## Goal Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| SC1: STATS_HEADERS contains 'closed' as 22nd element | PASS | `lib/commands/stats.ts:195` — `'closed'` appended to STATS_HEADERS array |
| SC2: recordIntegrationStats writes row with closed: 'yes' | PASS | test `task-1380: recordIntegrationStats sets closed: yes` at `test/stats-task-1380-closed-filter.test.js:21` — asserts `result.row.closed === 'yes'` |
| SC6: CSV without closed column loads without error | PASS | test `task-1380: backward compat — CSV without closed column treats all rows as closed` at `test/stats-task-1380-closed-filter.test.js:112` — asserts `data.rows[0].closed === 'yes'` |

## Next action
Implement CP-3: Update `summarizeMissionWindow`, `summarizeAgentWindow`, and `renderMissionPhaseReport` to filter by `closed === 'yes'`.
