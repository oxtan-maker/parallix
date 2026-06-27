# CP-2: Implement renderMissionPhaseReport call in recordPostIntegrationStats

## Work Done

Modified `lib/commands/integrate.js` at lines 1244-1248 to call `stats.renderMissionPhaseReport()` after the weekly stats output:

```javascript
const missionRows = outcome.data?.rows || [];
const missionReport = stats.renderMissionPhaseReport(missionRows, slug);
const firstLine = missionReport.split('\n')[0];
fmt.log.info(firstLine);
fmt.log.plain(missionReport.split('\n').slice(1).join('\n'));
```

Key design decisions:
- Used `outcome.data?.rows || []` to guard against `outcome.data` being undefined (risk mitigation from MISSION.md)
- Split output: first line ("Mission telemetry by phase: task-XXXX") goes through `fmt.log.info()` to produce `[INFO]` prefix; remaining lines go through `fmt.log.plain()` to preserve the table formatting
- Always renders the mission phase report (even when empty), matching the graceful empty-case behavior from `stats.js:834-841`

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `renderMissionPhaseReport` called after weekly stats | `lib/commands/integrate.js:1245` — `stats.renderMissionPhaseReport(missionRows, slug)` |
| 2 | Guard against missing `outcome.data` | `lib/commands/integrate.js:1244` — `outcome.data?.rows || []` |
| 3 | `[INFO]` prefix on mission phase header | `lib/commands/integrate.js:1247` — `fmt.log.info(firstLine)` |
| 4 | Weekly stats still printed in same order | `lib/commands/integrate.js:1240-1242` — unchanged, before mission phase block |
| 5 | Empty rows produce graceful output | `lib/commands/integrate.js:1244-1248` — always renders; `stats.js:834-841` handles empty case |

## Next action

Add/update tests in CP-3: update existing `recordPostIntegrationStats` tests to include `data: { rows: [] }` in mock returns, and add new tests for mission-phase output with rows and empty-rows edge case.
