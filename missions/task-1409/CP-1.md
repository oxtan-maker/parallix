# CP-1: Lock the Bug

## Summary

Created `test/stats-active-breakdown.test.js` with 5 reproduction tests that seed stats rows matching the backlog task's active-stage scenario and assert that the weekly, range, and per-mission reports reflect the expected breakdown. All 5 tests prove the current output is dishonest relative to the fixture.

## Goal Check

| # | Test Name | File:Line | Status | Evidence |
|---|-----------|-----------|--------|----------|
| 1 | active-stage rows visible in per-mission phase report | test/stats-active-breakdown.test.js:26 | FAIL | Phase report shows "No telemetry rows recorded" for active-stage mission task-1354 (line 76: `plain.includes('No telemetry rows recorded')`) |
| 2 | weekly agent performance includes active-stage agents | test/stats-active-breakdown.test.js:80 | FAIL | cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit absent from weekly agent table (line 124) |
| 3 | range agent performance includes active-stage agents | test/stats-active-breakdown.test.js:130 | FAIL | mistral, claude-sonnet-4-6, claude-sonnet-5 absent from range report (line 169) |
| 4 | existing model-based grouping preserved | test/stats-active-breakdown.test.js:173 | PASS | qwen3.5 grouped with 2 missions, gpt-5 separate with 1 mission (lines 236-237) |
| 5 | active and closed rows coexist without double-counting | test/stats-active-breakdown.test.js:219 | FAIL | gpt-5 shows 1 mission instead of 2 (closed + active) — active row excluded (line 262) |

## Root Cause Identified

The `closed === 'yes'` filter appears in three places:
- `renderMissionPhaseReport` at `lib/commands/stats.ts:1083` — hides active-stage rows from per-mission phase reports
- `summarizeAgentWindow` at `lib/commands/stats.ts:824` — excludes active-stage agents from weekly/range agent performance tables
- `summarizeMissionWindow` at `lib/commands/stats.ts:759` — excludes active-stage missions from mission counts (intentional for task-1380)

## Next action
Trace which report helpers transform active-stage rows incorrectly (CP-2).
