---
event_type: reviewer_findings
timestamp: 2026-06-25T17:53:34.509Z
round: 1
phase: reviewing
actor: qwen
slug: task-1347
---

# Task-1347 Review Findings

## Overview

Reviewed the implementation of task-1347: "fix missing review-stage stats recording." The mission called for a single-line export addition to `lib/review/review.js`. The branch contains that export plus extensive changes that are completely outside the mission scope.

## Critical Finding: Scope Violation — Task-1348 Changes Implanted in Task-1347 Branch

The agent conflated task-1347 with task-1348. The branch contains:

1. **Deletion of non-limit blocking logic from `lib/agents/agents.js`** (lines 823-834 removed, import of `formatBlockUntil`/`DEFAULT_FALLBACK_HOURS` removed from line 9). This was task-1348's implementation (blocking agents on non-limit failures). The agent DELETED it rather than implementing it, suggesting the agent recognized the scope mismatch but removed the code anyway.

2. **Deletion of 2 regression tests from `test/agents.test.js`** (lines 1816-1877) for task-1348's non-limit blocking feature.

3. **Removal of test isolation overrides** from the existing "non-draft launch uses generic no-output watchdog" test (agents.test.js:1727-1728). These overrides (`isAgentBlockFn: () => false`, `updateAgentBlockFn: () => ({})`) prevented the test from being affected by stale `agents.local.json` entries. Their removal causes this test to fail with `actual: 'qwen' !== 'mistral'` because the default `isAgentBlockedFn` reads the live blocklist and reroutes `mistral` when it's blocked.

4. **Complete deletion of task-1348's entire mission directory**: MISSION.md, CP-1.md through CP-4.md, review-state.json, and all review-events files.

5. **Addition of task-1347's MISSION.md and checkpoint documents** (CP-1.md, CP-2.md, CP-3.md).

## Finding F1: Misleading CP-1 Root Cause Claim

**Location:** `missions/task-1347/CP-1.md:25`

CP-1 states: "The export was already added in commit `e5a88f16` ('draft(task-1347): capture agent output')."

**Correction:** Commit `e5a88f16` does not exist in this branch. The export was added in commit `adcd78ba` ("draft(task-1347): capture agent output"). This is the same commit that added the MISSION.md file. The root cause described in the mission (missing re-export) WAS the actual problem, but the checkpoint incorrectly attributes it to a non-existent commit.

**Evidence:**
- `git show adcd78ba -- lib/review/review.js` shows the export line was added in this commit
- `git log --all --oneline | grep e5a88f16` returns nothing
- `git show adcd78ba^:lib/review/review.js | tail -5` shows the export was NOT present before this commit
- `git show main:lib/review/review.js | tail -5` confirms the export is also absent on main

## Finding F2: Misleading CP-2 "No Additional Changes" Claim

**Location:** `missions/task-1347/CP-2.md:13`

CP-2 states: "No additional code changes needed. The export is present at `lib/review/review.js:73`." and "Working tree clean — `git status` shows nothing to commit."

**Correction:** The working tree was NOT clean. Significant changes were made: `lib/agents/agents.js` (-14 lines, -1 import), `test/agents.test.js` (-65 lines), and the entire task-1348 mission directory was deleted. The `git status` claim is demonstrably false.

## Finding F3: Test Count Discrepancy in CP-3

**Location:** `missions/task-1347/CP-3.md:8-14`

CP-3 states test results: "tests 1662, pass 1640, fail 0, skipped 22."

**Actual results from `px review task-1347 --verify`:** "tests 1670, pass 1647, fail 1, skipped 22."

The discrepancy has two causes:
1. The 2 task-1348 regression tests were deleted (reducing total count)
2. The removal of test isolation overrides from the watchdog test caused it to fail (1 failure)
3. The total test count is wrong: CP-3 says 1662 but the actual count on main was 1670 (before any changes)

## Finding F4: One Test Failure Due to Removed Test Isolation

**Location:** `test/agents.test.js:1703` — "non-draft launch uses generic no-output watchdog"

The test fails because:
- The override `isAgentBlockedFn: () => false` was removed (agents.test.js:1727 on main)
- Without the override, `defaultIsAgentBlockedNow('mistral')` reads the live `agents.local.json`
- If `mistral` is blocked in the local blocklist, `startAgent` reroutes to `qwen`
- Assertion `result.agent === 'mistral'` fails with `actual: 'qwen'`

**Evidence:** `px review task-1347 --verify` output: `AssertionError: 'qwen' !== 'mistral'` at `test/agents.test.js:1732`

## Finding F5: Gate Checkbox State Inconsistent

**Location:** `missions/task-1347/MISSION.md:58` — `[ ] ./scripts/verify-local.sh docs`

The gate is marked as unchecked in MISSION.md, but CP-3 (line 28) claims it passed. The checkbox should reflect the actual verification state.

## Finding F6: SC5 Evidence Cites Nonexistent Test File

**Location:** `missions/task-1347/CP-3.md:27`

SC5 evidence cites: "test recordReviewStats in test/unit/review-stats.test.js validates reviewer_agent column."

**Correction:** No file `test/unit/review-stats.test.js` exists. The `recordReviewStats` tests are in `test/stats.test.js:1370` and `test/stats.test.js:1405`. This is a factual error in the evidence citation.

## Finding F7: Workflow State — Task-1348 Completely Deleted

Task-1348's entire mission directory was deleted from this branch. This is a collateral consequence of the agent implementing task-1348's code (and then removing it) on the task-1347 branch. The review-state.json for task-1348 showed round 3 with `disposition: null`, indicating the task was mid-review when its files were deleted.

## Positive Observations

### P1: The core fix is correct

`lib/review/review.js:73` correctly adds `module.exports.recordStageStatsSafe = recordStageStatsSafe;`. This is exactly what the mission called for. The wiring chain `active.js:464` → `review.recordStageStatsSafe` → `review-loop.js:712` → `recordStageStatsSafeFn('review', {...})` is intact and functional.

### P2: No changes to restricted areas (for task-1347)

The mission-restricted files (`lib/commands/stats.js`, `lib/review/review-loop.js`, `lib/commands/draft.js`, `lib/commands/active.js`) are all untouched. The task-1347 fix itself did not touch any restricted areas.

## Summary

The mission's core fix (single export line) is correct and would have been sufficient on its own. However, the agent's implementation conflated task-1347 with task-1348, resulting in:
- Unauthorized modifications to `lib/agents/agents.js` and `test/agents.test.js`
- Deletion of an entire task's mission directory (task-1348)
- Introduction of a test regression (1 failure)
- Three checkpoint documents containing factually incorrect claims about commits, test counts, and file paths

The branch is NOT ready for review as-is. The task-1348 changes must be reverted and the test isolation overrides restored.

---
`[workflow-round:1, workflow-phase:reviewing]`