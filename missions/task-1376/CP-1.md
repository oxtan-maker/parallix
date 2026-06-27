# CP-1: Grouping Logic Identification

## Summary

Identified the exact grouping logic in `summarizeAgentWindow` (stats.js:602-638) and confirmed that the `model` field is populated in the stats CSV schema for local AI telemetry rows.

### Key Findings

1. **Current grouping logic** (line 604): `groupBy(rows.filter(row => rowInWindow(row, window)), 'implementer')` — groups exclusively by `implementer`, causing all local AI rows with `implementer: 'custom'` to collapse into a single "custom" bucket.

2. **Model field presence**: The `model` column is part of `STATS_HEADERS` (line 22) as the 8th column. Rows with local AI telemetry carry the actual model name (e.g. `qwen3.5`, `llama3`) in this field while `implementer` is `custom`.

3. **Display rendering**: Both `renderWeeklyStatsReport` (line 738-750) and `renderRangeStatsReport` (line 769-775) use `row.implementer` as the display value in the "Agent family" column. Since `summarizeAgentWindow` returns the grouping key as `row.implementer`, changing the grouping key automatically changes the display value.

4. **Sorting** (line 644): Already sorts by `a.implementer.localeCompare(b.implementer)` which will sort model names alphabetically after the fix.

### No Blockers

The `model` field is reliably recorded in the CSV schema and populated by telemetry ingestion. No changes needed to data ingestion.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Grouping logic identified at stats.js:604 | File:line reference confirmed in `summarizeAgentWindow` |
| Model column in CSV schema | `STATS_HEADERS` at stats.js:22 includes `model` as column 8 |
| Display uses grouping key | renderWeeklyStatsReport at stats.js:740 uses `row.implementer` for Agent family column |
| Sorting already alphabetical | stats.js:644 sorts by `a.implementer.localeCompare(b.implementer)` |

## Next action: Implement the grouping change in summarizeAgentWindow — use model when non-empty, else implementer. Add unit tests.
