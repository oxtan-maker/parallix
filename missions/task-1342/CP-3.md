# CP-3: sinceMs telemetry isolation fix

## Goal Check

| Criterion | Status | Notes |
|-----------|--------|-------|
| Reviewer sinceMs uses reviewer launch time | PASS | Line 644 now uses `reviewerLaunchResult.result.startedAt` instead of `state.startedAt` |
| Implementer sinceMs uses implementer launch time | PASS | Line 859 now uses `implementerLaunchResult.result.startedAt` instead of `state.startedAt` |
| `npm test` passes | PASS | 1618 pass, 0 fail |

## Root Cause

`recordStageStatsSafe` in `review-loop.js` was passing `sinceMs: state.startedAt` (the review loop's start time) for both reviewer and implementer stages. This caused:

1. **Execute-phase telemetry bleed**: The implementer's `sinceMs` window started from the loop beginning, which overlapped with any prior reviewer telemetry recorded with the same window. When the stats renderer overwrites rows by `(repo, mission, stage)`, the cumulative `sinceMs` window from an earlier agent's session could contaminate the displayed metrics.

2. **Per-round row overwrites**: Each review round overwrote the same `(repo, mission, stage)` row. With a loop-wide `sinceMs`, later rounds accumulated all prior token usage, inflating the final displayed values.

## Fix

Changed both `recordStageStatsSafe` calls to use the per-agent launch result's `startedAt`:

- **Line 644** (review stage): `sinceMs` now derives from `reviewerLaunchResult.result.startedAt`
- **Line 859** (active/execute stage): `sinceMs` now derives from `implementerLaunchResult.result.startedAt`

This ensures each agent's telemetry window is bounded by its own session start, preventing cross-agent accumulation.

## Evidence

Before fix:
```
recordStageStatsSafe('review', { ..., sinceMs: state.startedAt })  // loop start
recordStageStatsSafe('active', { ..., sinceMs: state.startedAt })  // same loop start
```
Both stages share the same `sinceMs`, causing execute-phase rows to include tokens from the reviewer's earlier session.

After fix:
```
recordStageStatsSafe('review', { ..., sinceMs: reviewerLaunchResult.result.startedAt })
recordStageStatsSafe('active', { ..., sinceMs: implementerLaunchResult.result.startedAt })
```
Each stage uses its own agent's launch time, isolating telemetry windows per agent session.
