# CP-3: Retry lifecycle outcomes — valid repair unblocks, exhaustion stops review submission

## Summary

Covered retry lifecycle outcomes for the missing-checkpoint handoff repair bounce:

**Valid repaired checkpoint unblocks handoff** (`test/task-2261-checkpoint-gates-repro.test.ts:178`):
- `runHandoffAndReview` receives `validateCheckpointsBeforeHandoff` failure (no CP-N.md)
- Classifies as `IncompleteEvidence` → triggers bounded relaunch loop (max 2)
- Agent relaunch creates real `CP-1.md` with `## Goal Check` table and evidence rows
- Filesystem validation checks for CP-*.md files, Goal Check heading, 3-column table, and evidence rows
- Validation passes → proceeds to `performHandoff` → review loop starts
- Verified: 1 relaunch, CP-1.md exists on disk with Goal Check table, 3+ evidence rows, 1 handoff call, review loop called

**Repeated absent evidence reaches exhaustion** (`test/task-2261-checkpoint-gates-repro.test.ts:258`):
- `runHandoffAndReview` receives `validateCheckpointsBeforeHandoff` failure (no CP-N.md)
- Classifies as `IncompleteEvidence` → bounded relaunch loop (max 2 attempts)
- Re-validates checkpoints after each relaunch → still `ok: false` (agent didn't create CP)
- After 2 failed relaunches: returns `false` with manual instruction (Create CP-N.md + `px review <slug> --submit`)
- Verified: 2 relaunches, 0 handoff calls, review loop NOT called, manual instruction emitted

**Relaunch failure handled gracefully** (`test/task-2261-checkpoint-gates-repro.test.ts:293`):
- Agent launcher not available → `relaunched: false` on first attempt
- Loop breaks early → returns `false` with manual instruction (no performHandoff call)
- Verified: 1 relaunch attempt, 0 handoff calls, review loop NOT called, manual instruction emitted

**Bounded retry in handoff-failure path** (`test/task-2261-checkpoint-gates-repro.test.ts:148`):
- `performHandoff` returns IncompleteEvidence → relaunch loop (max 2 attempts at `active.ts:462`)
- After 2 failed relaunches: `handoffResult.error` set to exhaustion message
- Review loop NOT called when exhaustion reached

**Dirty checkpoint regression** (`test/task-2261-checkpoint-gates-repro.test.ts:329`):
- Dirty checkpoint classified as `GitBlockers`/`AutoRepair` → does NOT enter IncompleteEvidence relaunch loop
- Returns `false` immediately with 0 relaunch attempts
- Verified: GitBlockers retains existing non-relaunch handling (mission risk mitigation)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Valid repaired checkpoint unblocks handoff without missing-checkpoint error | `test/task-2261-checkpoint-gates-repro.test.ts:178` — "missing checkpoint: valid CP after relaunch unblocks handoff and starts review loop" (filesystem fixture with CP-1.md, Goal Check table, 3+ evidence rows) | PASS |
| Repeated absent evidence reaches exhaustion boundary without review submission | `test/task-2261-checkpoint-gates-repro.test.ts:258` — "missing checkpoint: still absent after relaunch returns false with manual instruction" (asserts `relaunchCount === 2`); `test/task-2261-checkpoint-gates-repro.test.ts:148` — "exhaustion: runHandoffAndReview stops after bounded relaunch attempts without submitting review" | PASS |
| Relaunch failure returns false with manual instruction | `test/task-2261-checkpoint-gates-repro.test.ts:293` — "missing checkpoint: relaunch failure returns false with manual instruction" | PASS |
| Bounded retry limit enforced (max 2 for both pre-handoff and handoff-failure paths) | `src/platform/runtime/lib/commands/active.ts:402` — `const maxCheckpointRelaunches = 2` (pre-handoff); `src/platform/runtime/lib/commands/active.ts:462` — `const maxRelaunches = 2` (handoff-failure); `test/task-2261-checkpoint-gates-repro.test.ts:258` — asserts `relaunchCount === 2`; `test/task-2261-checkpoint-gates-repro.test.ts:148` — asserts `relaunchCount >= 2` | PASS |
| Non-IncompleteEvidence errors retain existing behavior (dirty checkpoints) | `test/task-2261-checkpoint-gates-repro.test.ts:329` — "dirty checkpoint: GitBlockers classification does NOT enter the IncompleteEvidence relaunch loop" (asserts `relaunchCount === 0`); `test/task-2261-checkpoint-gates-repro.test.ts:365` — classification test | PASS |
| Focused tests pass (reproduction, targeted relaunch, valid repair, exhaustion, dirty regression) | `npm test -- test/task-2261-checkpoint-gates-repro.test.ts` — 12 tests, 0 failures | PASS |
| `./scripts/verify-local.sh all` passes | `./scripts/verify-local.sh all` — PASS | PASS |

Next action: All checkpoints complete. Commit CP-3, verify gates pass, and hand off to review.
