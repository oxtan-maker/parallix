# CP-3: Current-Week Spend Table Implementation

## Work Done

Confirmed the current-week spend table is fully implemented in `renderWeeklyStatsReport()` at `lib/commands/stats.ts:1146-1157`.

### Implementation Details

1. **Aggregation** (`summarizeAgentStageSpend` at line 972):
   - Calls `computeAgentMissionGroups()` to reuse the same mission dedup and display-key grouping as `summarizeAgentWindow()`
   - Fans back out over every raw window row (not just deduped winners) to sum each stage's spend metric
   - Maps stored stage `active` → bucket `active` (then displayed as `execute`)
   - Unknown stages fall through to `default` bucket

2. **Rendering** (lines 1147-1157):
   - Header: `"Agent spend by stage this week (<date range>)"`
   - Columns: `Agent family`, `draft`, `execute`, `review`, `follow-up`, `default`, `total`
   - Each cell: `<metric> (<share %>)` via `formatAgentSpendCell()`
   - Empty row: `none` with `—` for all cells when no spend data

3. **Preservation of existing tables**: The current-week mission count table, previous-week mission count table, "Agent performance this week", and "Agent performance previous week" are all preserved unchanged.

### Files Modified

- `lib/commands/stats.ts` — Added `AGENT_SPEND_STAGE_COLUMNS` (line 930), `classifyAgentSpendFamily` (line 949), `summarizeAgentStageSpend` (line 972), `formatAgentSpendCell` (line 1016), and render insertion (lines 1146-1157)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| New table columns: draft, execute, review, follow-up, default, total | `lib/commands/stats.ts:930-936` — `AGENT_SPEND_STAGE_COLUMNS` defines exactly these 6 columns |
| Rows use same display keys/ordering as "Agent performance this week" | Both use `computeAgentMissionGroups()` at `lib/commands/stats.ts:830` |
| Stage `active` aliased to `execute` in display | `lib/commands/stats.ts:932` — `{ stage: 'active', label: 'execute' }` |
| Metric family selection per agent | `lib/commands/stats.ts:949-958` — `classifyAgentSpendFamily()` |
| Cell format: `<metric> (<share %>)` | `lib/commands/stats.ts:1016-1025` — `formatAgentSpendCell()` |
| Empty state renders `—` not `0%` | `lib/commands/stats.ts:1017` — `if (!total) {return '—';}` |
| Existing tables preserved | `lib/commands/stats.ts:1126-1144` — mission counts and agent performance unchanged |

## Next action: CP-4 — Add regression tests
