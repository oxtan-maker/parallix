# CP-1: Confirm change location and renderMissionPhaseReport signature

## Work Done

Confirmed the change location and API compatibility:

1. **Change location**: `recordPostIntegrationStats` function at `lib/commands/integrate.js:1218-1244`
2. **`stats` import**: Already imported at `lib/commands/integrate.js:13` via `const stats = require('./stats');`
3. **Export verification**: `renderMissionPhaseReport` exported at `lib/commands/stats.js:1709`
4. **Function signature**: `renderMissionPhaseReport(rows, slug, options = {})` at `lib/commands/stats.js:799`
   - `rows`: Array of stats CSV row objects (filtered by mission slug and repo)
   - `slug`: String mission identifier (e.g. "task-XXXX")
   - `options`: Optional object with `repo` and `rootDir`
5. **Empty rows behavior**: When `rows` is empty, prints a dashes table with "No telemetry rows recorded for mission" header — no crash (verified at `stats.js:834-841`)

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `stats` module imports `renderMissionPhaseReport` | `lib/commands/integrate.js:13` — `const stats = require('./stats');` |
| 2 | `renderMissionPhaseReport` is exported | `lib/commands/stats.js:1709` — `module.exports.renderMissionPhaseReport = renderMissionPhaseReport;` |
| 3 | Signature accepts `(rows, slug, options)` | `lib/commands/stats.js:799` — `function renderMissionPhaseReport(rows, slug, options = {})` |
| 4 | Empty rows handled gracefully | `lib/commands/stats.js:834-841` — prints dashes table + "No telemetry rows recorded for mission" message, returns early |
| 5 | `recordPostIntegrationStats` is the target function | `lib/commands/integrate.js:1218` — function declaration |

## Next action

Implement the change in CP-2: add the `renderMissionPhaseReport` call after the weekly stats output in `recordPostIntegrationStats`.
