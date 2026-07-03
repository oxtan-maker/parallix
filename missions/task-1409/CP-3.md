# CP-3: Fix the Affected Report Paths

## Summary

Made two minimal code changes to fix the active-stage representation bug:

### Fix 1: `renderMissionPhaseReport` — removed closed filter
- **File:** `lib/commands/stats.ts:1080-1083`
- **Change:** Removed `row.closed === 'yes'` from the mission row filter
- **Before:** Filtered to `mission && repo && closed === 'yes'`
- **After:** Filters to `mission && repo` (all stages shown)
- **Effect:** Per-mission phase report now shows draft, active, review, and follow-up rows for in-progress missions

### Fix 2: `summarizeAgentWindow` — include active-stage rows
- **File:** `lib/commands/stats.ts:822-828`
- **Change:** Renamed `validWindowRows` (closed-only) to `allValidWindowRows` (all valid classification)
- **Effect:** Agent performance tables in weekly and range reports now include active-stage agents alongside closed agents

### What was NOT changed
- `summarizeMissionWindow` closed filter at line 759: Intentional (task-1380). Mission counts remain closed-only.
- Model-based grouping logic: Preserved. Agents group by model name when populated, fall back to implementer.
- Deduplication by (repo, mission): Same preference logic (model===implementer preferred, then highest fix rounds).

## Goal Check

| # | Change | File:Line | Evidence |
|---|--------|-----------|----------|
| 1 | Phase report: removed closed filter | lib/commands/stats.ts:1080-1083 | Filter now checks `mission && repo` only, no `closed` predicate |
| 2 | Agent table: include active rows | lib/commands/stats.ts:822-828 | `allValidWindowRows` replaces `closedWindowRows` + `validWindowRows` |
| 3 | Phase report test passes | test/stats-active-breakdown.test.js:26 | `assert.ok(!plain.includes('No telemetry rows recorded'))` passes |
| 4 | Weekly agent test passes | test/stats-active-breakdown.test.js:80 | `assert.ok(plain.includes('cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit'))` passes |
| 5 | Range agent test passes | test/stats-active-breakdown.test.js:130 | `assert.ok(plain.includes('mistral'))` passes |
| 6 | Model grouping preserved | test/stats-active-breakdown.test.js:173 | `assert.match(plain, /qwen3\.5\s+2\s+1\.50/)` passes |
| 7 | Coexistence test passes | test/stats-active-breakdown.test.js:219 | `assert.match(plain, /gpt-5\s+2\s+/)` passes |

## Next action
Extend regression coverage by running all existing stats tests to ensure nothing regressed (CP-4).
