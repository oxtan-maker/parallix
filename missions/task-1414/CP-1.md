# CP-1: Insertion Point and Row Source Confirmation

## Work Done

Examined `lib/commands/stats.ts` to confirm the exact insertion point and row source for the new agent spend-by-stage table.

### Findings

1. **Insertion point**: `renderWeeklyStatsReport()` at line 1112. The new table is inserted at lines 1146-1157, immediately after the "Agent performance this week" table and before the "Agent performance previous week" table.

2. **Row source**: The helper `summarizeAgentStageSpend()` at line 972 reuses `computeAgentMissionGroups()` (same function behind `summarizeAgentWindow()` at line 830), so rows share the exact same display-key grouping and ordering as the existing "Agent performance this week" table.

3. **Helper placement**: Three new helpers sit next to `summarizeAgentWindow()`:
   - `AGENT_SPEND_STAGE_COLUMNS` constant (line 930) — canonical stage mapping
   - `classifyAgentSpendFamily()` (line 949) — metric family classification per agent
   - `summarizeAgentStageSpend()` (line 972) — spend aggregation
   - `formatAgentSpendCell()` (line 1016) — cell formatting

4. **No new top-level helper needed outside the render path**: The aggregation logic (`summarizeAgentStageSpend`) is its own function called from the render path, keeping the render function clean.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Insertion point confirmed in `renderWeeklyStatsReport()` | `lib/commands/stats.ts:1146-1157` — spend table rendered after "Agent performance this week" |
| Same row source as `summarizeAgentWindow()` | Both call `computeAgentMissionGroups()` at `lib/commands/stats.ts:830` |
| New helpers sit next to `summarizeAgentWindow()` | `classifyAgentSpendFamily` at line 949, `summarizeAgentStageSpend` at line 972, `formatAgentSpendCell` at line 1016 |

## Next action: CP-2 — Define the spend aggregation contract in code comments/tests
