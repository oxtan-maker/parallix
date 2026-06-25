# CP-1: Confirm Root Cause

## Work Done

Inspected `lib/review/review.js` to confirm that it imports `recordStageStatsSafe` from `./review-loop` at line 19:

```js
const { maybeUpdateGraphifyBeforeReview, commitSafeMissionArtifacts, rebaseBeforeReviewRound, applyAgentFallback, persistNormalizedPhaseRepair, startReviewLoop, recordStageStatsSafe } = require('./review-loop');
```

Then verified that line 73 of the same file contains the re-export:

```js
module.exports.recordStageStatsSafe = recordStageStatsSafe;
```

Also inspected `lib/commands/active.js:464`:

```js
_startReviewLoop(slug, { implementer: agent, worktree, recordStageStatsSafeFn: review.recordStageStatsSafe });
```

And confirmed `lib/review/review-loop.js:712` calls `recordStageStatsSafeFn('review', {...})` which invokes `stats.accumulateStageStats` with `stage='review'`.

The export was already added in commit `adcd78ba` ("draft(task-1347): capture agent output"). The wiring is correct: `active.js:464` → `review.recordStageStatsSafe` → `review-loop.js:startReviewLoop` → `recordStageStatsSafeFn('review', ...)`.

## Root Cause Confirmation

The mission description stated the export was missing. Investigation showed the export line was already present on line 73 of `review.js`, added in commit `adcd78ba`. The root cause identified in the mission (missing re-export) was resolved by that earlier commit.

## Review Round 1 Findings — Reverted Scope Violations

Round 1 review flagged unauthorized scope expansion: task-1348 code removal from `lib/agents/agents.js`, `test/agents.test.js`, and deletion of `missions/task-1348/`. All three were reverted in this round:
- `lib/agents/agents.js` restored to main (import + non-limit blocking logic)
- `test/agents.test.js` restored to main (test isolation overrides + 2 regression tests)
- `missions/task-1348/` restored from main (MISSION.md, CP-1–4, review-state.json, review-events/)

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| SC1: `recordStageStatsSafe` exported | `lib/review/review.js:73` — `module.exports.recordStageStatsSafe = recordStageStatsSafe;` |
| SC2: `active.js` passes non-noop function | `lib/commands/active.js:464` — `recordStageStatsSafeFn: review.recordStageStatsSafe` |
| SC3: review-loop calls with stage='review' | `lib/review/review-loop.js:712` — `recordStageStatsSafeFn('review', {...})` |
| Root cause confirmed | `review.js:19` imports `recordStageStatsSafe`; `review.js:73` re-exports it; commit `adcd78ba` added the line |
| Scope violations reverted | `lib/agents/agents.js`, `test/agents.test.js`, `missions/task-1348/` restored from main |

## Next action: Verify all tests pass with zero regressions (CP-3)
