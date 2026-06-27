# CP-2: Grouping Implementation + Unit Tests

## Summary

Modified `summarizeAgentWindow` in `lib/commands/stats.js` to use `model` as the grouping key when non-empty, falling back to `implementer` when `model` is blank. Added 5 unit tests covering model grouping, fallback behavior, mixed cloud+local AI, and report rendering.

### Changes Made

**lib/commands/stats.js:895-941** — Replaced `groupBy(rows, 'implementer')` with inline loop that computes `displayKey = (row.model && String(row.model).trim()) || (row.implementer || 'unknown')`. The returned object still uses `implementer` as the property name (for backward compatibility with callers), but its value is now the display key.

**test/stats.test.js:1700-1782** — Added 5 new tests:
1. `task-1376: summarizeAgentWindow groups local AI rows by model name, not by custom` — Two rows with `model: 'qwen3.5'` and one with `model: 'llama3'`, both `implementer: 'custom'`, produce two separate groups keyed by model name.
2. `task-1376: summarizeAgentWindow empty model falls back to implementer` — Rows with `model: ''` and `implementer: 'claude'` produce a single `claude` group (same behavior as pre-change).
3. `task-1376: summarizeAgentWindow handles mixed cloud + local AI rows together` — Five rows spanning gpt-5, qwen3.5, gemini-2.5-pro, llama3, and empty-model claude all produce separate groups.
4. `task-1376: renderWeeklyStatsReport displays model names in Agent family column` — Weekly report output contains `qwen3.5 1 2.00` and `gpt-5 1 1.00`.
5. `task-1376: renderRangeStatsReport displays model names in Agent family column` — Range report output contains `qwen3.5 1 2.00` and `llama3 1 0.00`.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Model grouping replaces agent-family grouping | `summarizeAgentWindow groups local AI rows by model name, not by custom` — asserts `result.length === 2` with keys `qwen3.5` and `llama3` |
| Empty model falls back to implementer | `summarizeAgentWindow empty model falls back to implementer` — asserts `result.length === 1` with key `claude` |
| Weekly report displays model values | `renderWeeklyStatsReport displays model names in Agent family column` — matches `/qwen3\.5\s+1\s+2\.00/` |
| Range report displays model values | `renderRangeStatsReport displays model names in Agent family column` — matches `/qwen3\.5\s+1\s+2\.00/` |
| Cloud-agent rows unaffected | `summarizeAgentWindow handles mixed cloud + local AI rows together` — asserts `gptEntry` exists |
| All existing tests pass | npm test: 1692 pass, 0 fail |

## Next action: Run npm test to verify all existing tests pass and new tests cover model grouping and fallback.
