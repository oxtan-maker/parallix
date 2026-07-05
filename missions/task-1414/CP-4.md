# CP-4: Regression Tests

## Work Done

Confirmed 6 regression tests exist in `test/stats.test.js` covering the new spend table for all three metric families, model-name grouping, and empty-state rendering.

### Test Coverage

| Test | Line | What It Verifies |
|---|---|---|
| `task-1414: renderWeeklyStatsReport adds an agent spend-by-stage table with the contracted columns` | 490 | Table header present with exact columns: `Agent family`, `draft`, `execute`, `review`, `follow-up`, `default`, `total` |
| `task-1414: renderWeeklyStatsReport aggregates a Codex row from openai_usage_after with stage active shown as execute` | 500 | Codex row: `draft=20% (20%) execute=30% (30%) review=50% (50%)` from `openai_usage_after`; `active` mapped to `execute`; no `$` or `m` in output |
| `task-1414: renderWeeklyStatsReport aggregates a Claude row from cost_usd, not tokens/duration/usage` | 515 | Claude row: `draft=$1 (10%) execute=$3 (30%) review=$6 (60%)`; `999` (noise values) not present |
| `task-1414: renderWeeklyStatsReport aggregates a Custom/local row from duration_minutes, not cost or usage` | 528 | Custom row: `draft=5m (10%) execute=15m (30%) review=30m (60%)`; `999` (noise values) not present |
| `task-1414: renderWeeklyStatsReport spend table groups a local model row by model name, matching Agent performance this week` | 541 | Model `qwen3.5` appears in both "Agent performance this week" and spend table; `custom` does not appear in spend table |
| `task-1414: renderWeeklyStatsReport spend table renders a stable empty state instead of misleading 0% for a row with no spend` | 555 | Zero-spend row renders `—` in all columns, not `0%` |

### Test Execution

All 67 tests in `test/stats.test.js` pass (0 failures).

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Codex row test with stage-distributed data | `test/stats.test.js:500` — test name: `task-1414: renderWeeklyStatsReport aggregates a Codex row from openai_usage_after with stage active shown as execute`; assertions at lines 508-512 |
| Claude row test with stage-distributed data | `test/stats.test.js:515` — test name: `task-1414: renderWeeklyStatsReport aggregates a Claude row from cost_usd, not tokens/duration/usage`; assertions at lines 523-525 |
| Custom/local row test with stage-distributed data | `test/stats.test.js:528` — test name: `task-1414: renderWeeklyStatsReport aggregates a Custom/local row from duration_minutes, not cost or usage`; assertions at lines 536-538 |
| `<metric> (<share %>)` cell format verified | `test/stats.test.js:509` — `assert.match(spendSection, /codex\s+20% \(20%\)\s+30% \(30%\)\s+50% \(50%\)\s+0% \(0%\)\s+0% \(0%\)\s+100% \(100%\)/)` |
| Empty state verified | `test/stats.test.js:562` — `assert.match(spendSection, /custom\s+—\s+—\s+—\s+—\s+—\s+—/)` |
| No `.only` or bare `.skip` in test file | Verified by grep — no violations |

## Next action: CP-5 — Run verify-local.sh all
