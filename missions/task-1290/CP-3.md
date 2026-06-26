# CP-3: Model ID/Provenance in Stats/Telemetry

## Summary
Threaded actual model ID/provenance from agent resolution into stats recording at every stage boundary (draft, active, review, follow-up). Added `setOpencodeDefaultModel()` to `opencode-telemetry.js` so telemetry extraction falls back to configured model when JSON payload lacks it. Updated `stats.js` stage functions to accept `model` param. Updated `active.js`, `review-loop.js`, and `draft.js` to call `resolveAgentModel()` at stage transitions.

## Goal Check

| Goal | Status |
|------|--------|
| `extractOpencodeTelemetryFromExport` uses `setOpencodeDefaultModel()` fallback | DONE |
| `telemetryToStatsFields` accepts `model` param | DONE |
| `recordStageStats` accepts `model` param | DONE |
| `accumulateStageStats` accepts `model` param | DONE |
| `recordActiveStats` threads `resolveAgentModel(agent, worktree)` | DONE |
| `recordReviewStats` threads `resolveAgentModel(reviewer/implementer, worktree)` | DONE |
| `recordDraftStats` threads `resolveAgentModel(agentFamily, rootDir)` | DONE |
| `review-loop.js` `recordStageStatsSafe` accepts `model` | DONE |
| Tests updated for `custom` agent family | DONE |
| All tests pass (1650 pass, 0 fail) | DONE |

## Non-Generic Next Action
Run `npm test` one final time to confirm clean pass state before committing all changes.
