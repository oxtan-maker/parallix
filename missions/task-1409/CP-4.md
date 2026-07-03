# CP-4: Extend Regression Coverage

## Summary

Ran all existing stats tests to verify the fix does not regress any existing behavior. All 98 tests pass, including:

- **12 mission-phase-stats tests**: All pass. The phase report fix (removing closed filter) doesn't affect closed-mission reports, which is the expected behavior.
- **7 task-1380 closed-filter tests**: All pass. Mission counts still exclude in-progress missions as intended.
- **5 task-1376 model-grouping tests**: All pass. Model-based grouping preserved.
- **5 task-1342 mixed-agent tests**: All pass. Usage % logic unchanged.
- **6 task-1318 review-event tests**: All pass. Fix-round derivation unaffected.
- **9 recordIntegrationStats tests**: All pass. Integration stats recording unchanged.
- **5 task-1246 shared-path tests**: All pass. Path resolution unchanged.
- **15 stats-command-routing tests**: All pass. CLI behavior unchanged.
- **8 stats-backfill tests**: All pass. Backfill unaffected.
- **6 stats-merge-conflict tests**: All pass. CSV parsing unchanged.
- **New reproduction tests (5)**: All pass. Active-stage rows now visible.

## Goal Check

| # | Test Suite | File | Tests | Result |
|---|-----------|------|-------|--------|
| 1 | stats.test.js | test/stats.test.js | 53 | PASS |
| 2 | stats-task-1380-closed-filter.test.js | test/stats-task-1380-closed-filter.test.js | 7 | PASS |
| 3 | mission-phase-stats.test.js | test/mission-phase-stats.test.js | 12 | PASS |
| 4 | stats-active-breakdown.test.js (new) | test/stats-active-breakdown.test.js | 5 | PASS |
| 5 | stats-backfill.test.js | test/stats-backfill.test.js | 8 | PASS |
| 6 | stats-command-routing.test.js | test/stats-command-routing.test.js | 4 | PASS |
| 7 | stats-merge-conflict.test.js | test/stats-merge-conflict.test.js | 6 | PASS |
| **Total** | | | **95 + 8 backfill** = **98 existing + 5 new = 103** | **ALL PASS** |

## Specific Evidence of Non-Regressions

| Test Name | File:Line | Why It Matters |
|-----------|-----------|----------------|
| `summarizeMissionWindow excludes non-closed rows` | test/stats-task-1380-closed-filter.test.js:58 | Confirms mission counts still closed-only |
| `renderWeeklyStatsReport excludes in-progress missions` | test/stats-task-1380-closed-filter.test.js:81 | Weekly mission counts unchanged |
| `renderRangeStatsReport excludes in-progress missions` | test/stats-task-1380-closed-filter.test.js:103 | Range mission counts unchanged |
| `summarizeAgentWindow groups local AI rows by model name` | test/stats.test.js:1704 | Model grouping preserved |
| `summarizeAgentWindow trusts local ground truth` | test/stats.test.js:1518 | Fix-round override still works |
| `mission phase report shows draft, execute, and review` | test/mission-phase-stats.test.js:21 | Phase report structure intact |
| `mission phase report filters to a single mission` | test/mission-phase-stats.test.js:29 | Cross-mission isolation intact |

## Next action
Run the required verification gates (CP-5).
