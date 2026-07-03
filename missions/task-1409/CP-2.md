# CP-2: Identify the Real Failure Mode

## Summary

Traced the `closed === 'yes'` filter through all three report surfaces. The issue is **wrong filtering** — active-stage rows are excluded from reports where they should be visible.

## Failure Modes

### 1. `renderMissionPhaseReport` — wrong filtering (BUG)
- **File:** `lib/commands/stats.ts:1083`
- **Code:** `row.closed === 'yes'`
- **Effect:** Per-mission phase report shows "No telemetry rows recorded" for any mission that hasn't been integrated yet. Active-stage rows (with empty/undefined `closed`) are invisible.
- **Classification:** BUG — The per-mission phase report is meant to show the full lifecycle breakdown of a single mission. Filtering to closed-only defeats its purpose for in-progress missions.

### 2. `summarizeAgentWindow` — wrong filtering (BUG)
- **File:** `lib/commands/stats.ts:824`
- **Code:** `const closedWindowRows = windowRows.filter(row => row.closed === 'yes')`
- **Effect:** Agent performance tables in weekly and range reports exclude active-stage agents entirely. The model-based grouping (lines 858-862) never sees active-stage rows.
- **Classification:** BUG — The agent performance table shows "who is implementing" and should include active-stage work. Mission counts (handled by `summarizeMissionWindow`) correctly exclude in-progress missions.

### 3. `summarizeMissionWindow` — intentional (NOT A BUG)
- **File:** `lib/commands/stats.ts:759`
- **Code:** `const closedRows = windowRows.filter(row => row.closed === 'yes')`
- **Effect:** Mission count tables exclude in-progress missions.
- **Classification:** INTENTIONAL — This was the fix for task-1380. In-progress missions should not inflate throughput counts.

## What the fix must do

1. **Per-mission phase report:** Remove `row.closed === 'yes'` filter. Show all rows for the mission regardless of closed status.
2. **Agent performance tables:** Include non-closed rows (active-stage) alongside closed rows. Keep mission counts closed-only.
3. **Mission counts:** Leave unchanged — closed-only is correct.

## Next action
Implement the fix for the two affected report paths (CP-3).
