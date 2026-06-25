# CP-2: Apply Fix

## Work Done

The fix (adding `module.exports.recordStageStatsSafe = recordStageStatsSafe;` to `lib/review/review.js`) was already applied in commit `adcd78ba` ("draft(task-1347): capture agent output"). Diff from that commit:

```diff
 // From review-loop
+module.exports.recordStageStatsSafe = recordStageStatsSafe;
 module.exports.maybeUpdateGraphifyBeforeReview = maybeUpdateGraphifyBeforeReview;
```

No additional code changes were needed for the core fix. During review round 1, scope violations (task-1348 code removal from `lib/agents/agents.js`, `test/agents.test.js`, and `missions/task-1348/`) were identified and reverted to main.

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| Fix applied | `lib/review/review.js:73` — `module.exports.recordStageStatsSafe = recordStageStatsSafe;` |
| Fix committed | commit `adcd78ba` — "draft(task-1347): capture agent output" |
| Scope violations reverted | `lib/agents/agents.js`, `test/agents.test.js`, `missions/task-1348/` restored from main |

## Next action: Run npm test to verify zero regressions (CP-3)
