# CP-2: Checkpoint discovery, classification, and targeted repair relaunch

## Summary

Implemented checkpoint discovery classification and targeted repair relaunch for missing checkpoint documents.

**Classification** (`repair-handoff.ts:81-90`):
- `classifyError` pattern 1b: recognizes "missing a ## Goal Check section" → `IncompleteEvidence` / `AutoSendBack`
- `classifyError` pattern 1c: recognizes "No checkpoint documents found" + "Goal Check table" → `IncompleteEvidence` / `AutoSendBack`
- Both patterns checked before generic gate patterns (order: 1b, 1c before 2)

**Targeted relaunch prompt** (`repair-handoff.ts:264-275`):
- `buildGoalCheckRepairPrompt` detects `isMissingCheckpoint` via "No checkpoint documents found"
- Missing checkpoint: "Please create a checkpoint document (CP-1.md) in ${missionDir}"
- Existing checkpoint with bad evidence: "Please fix the final checkpoint document in ${missionDir}"
- Both variants include: `## Goal Check` heading, `| Criterion | Evidence | Status |` table, accepted evidence forms, and `px review <slug> --submit` retry command

**Repair relaunch flow** (`active.ts:381-420`):
- `runHandoffAndReview` classifies checkpoint validation errors via `repairHandoff.classifyError()`
- `IncompleteEvidence` → triggers `attemptAgentRelaunchFn` with targeted prompt
- After relaunch: re-validates checkpoints; if present, proceeds to `performHandoff`
- If still missing: emits manual instruction with retry command
- If relaunch fails: emits manual instruction with retry command

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Missing CP-N.md classified as repairable incomplete-evidence failure | `src/platform/runtime/lib/commands/repair-handoff.ts:81-90` — classifyError pattern 1c; `test/task-2261-checkpoint-gates-repro.test.js:55` | PASS |
| Checkpoint without valid Goal Check classified as repairable | `src/platform/runtime/lib/commands/repair-handoff.ts:81-85` — classifyError pattern 1b; `test/task-2261-checkpoint-gates-repro.test.js:86` | PASS |
| Targeted relaunch names mission, CP-N.md, Goal Check heading, table columns | `test/task-2261-checkpoint-gates-repro.test.js:68` — "missing checkpoint: buildRelaunchPrompt names the required CP-N.md and Goal Check requirements" | PASS |
| Targeted relaunch supplies `px review <slug> --submit` retry command | `test/task-2261-checkpoint-gates-repro.test.js:76` — asserts `px review task-2261 --submit` in prompt | PASS |
| runHandoffAndReview triggers relaunch for missing checkpoints | `src/platform/runtime/lib/commands/active.ts:381-420` — checkpoint classification and relaunch flow; `test/task-2261-checkpoint-gates-repro.test.js:17` | PASS |
| Focused tests pass | `npm test -- test/task-2261-checkpoint-gates-repro.test.js test/handoff.test.ts test/repair-handoff.test.ts test/active.test.ts` — 236 tests, 0 failures | PASS |
| `./scripts/verify-local.sh all` passes | `./scripts/verify-local.sh all` — 1254 tests, 0 failures | PASS |

Next action: Commit CP-2, run `./scripts/verify-local.sh all` for final verification, and hand off.
