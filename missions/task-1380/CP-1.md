# CP-1: Lock the Bug

## Summary

Authored reproduction test in `test/stats-task-1380-closed-filter.test.js`. All 6 tests fail, confirming the bug: stats reports count in-progress missions because the `closed` column does not exist in `STATS_HEADERS`, `recordIntegrationStats` does not set `closed: 'yes'`, `summarizeMissionWindow` does not filter by `closed`, and `normalizeStatsRow` does not default missing `closed` to `'yes'`.

## Goal Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Test file exists | PASS | `test/stats-task-1380-closed-filter.test.js` (6 tests) |
| STATS_HEADERS missing `closed` | CONFIRMED BUG | test fails: `STATS_HEADERS should include the "closed" column` |
| recordIntegrationStats does not set `closed: 'yes'` | CONFIRMED BUG | test fails: `undefined !== 'yes'` at line 49 |
| summarizeMissionWindow does not filter non-closed | CONFIRMED BUG | test fails: TypeError `_internals.summarizeMissionWindow is not a function` |
| Weekly report counts all rows | CONFIRMED BUG | test fails: reports `3` missions instead of `1` |
| Range report counts all rows | CONFIRMED BUG | test fails: reports `2` missions instead of `1` |
| Backward compat missing closed | CONFIRMED BUG | test fails: `undefined !== 'yes'` at line 132 |

## Next action
Implement CP-2: Add `closed` to `STATS_HEADERS`, update `normalizeStatsRow` to default `closed: 'yes'`, update `recordIntegrationStats` to set `closed: 'yes'`, and export `summarizeMissionWindow` in `_internals`.
