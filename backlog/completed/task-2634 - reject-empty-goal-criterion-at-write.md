---
id: TASK-2634
title: reject empty goal criterion/evidence at checkpoint write time
status: done
assignee: [claude]
created_date: '2026-10-02 10:45'
labels: [ai_sdlc]
dependencies: [TASK-2633]
---

## Problem

An agent can persist a checkpoint Goal Check with an **empty `criterion`** (and
empty `evidence`). `task-2618` checkpoint 3 has 4 rows with `criterion=''`,
`evidence=''`. This is an incomplete/hallucinated write.

Today the only guard is read-time in `mission-serialization.ts:243`
(`requiredText`), which throws `Persisted Mission goal criterion must not be
empty` — and that throw aborts hydration of the **entire repository**, taking
down mission flow and agent performance for every repo mission
(`TASK-2633`). The guard exists at the wrong end of the pipe: it should fail
closed at write, not explode at read.

Write path has no validation at all:
- `src/domain/checkpoint.ts` `GoalCheckRow { criterion, evidence }` — no
  non-empty constraint.
- `src/application/mission-checkpoint-service.ts` `recordGoalCheck` — rejects
  "already has evidence" and "not planned", but never checks the strings are
  non-empty.
- `src/adapters/sqlite/mission-store.ts:589` inserts whatever domain gives.

So an agent that records a checkpoint before it has real criterion/evidence
writes garbage into `mission_checkpoint_goal_checks`, which then poisons every
read of that repo.

## Proposal

Fail closed at write. Reject a Goal Check whose `criterion` (or `evidence`) is
empty/whitespace-only:

- Domain: `GoalCheckRow` contract / `recordGoalCheck` validates
  `criterion.trim() !== ''` before the mission is mutated. Throw a clear
  domain error (`Checkpoint goal criterion must not be empty`) that the CLI can
  surface to the agent as a fixable rejection, not a DB corruption.
- Keep the persistence `requiredText` guard as a defense-in-depth invariant
  (now unreachable from normal writes, still catches legacy rows).
- `task-2633` makes reads tolerant of the legacy rows that already exist; this
  stops new ones.

## Notes

- This is the write-side fix; the read-side resilience and the stats
  restoration are `TASK-2633`. Order: 2634 (write guard) and 2633 (read
  resilience) are independent — 2633's data repair can delete the existing
  `task-2618` rows, 2634 prevents recurrence.
- The domain error must be catchable by the agent's checkpoint command so it can
  correct the criterion, not a hard crash.

## Verification

- Recording a Goal Check with empty `criterion` is rejected before any row is
  written to `mission_checkpoint_goal_checks`.
- A valid non-empty criterion/evidence records normally.
- Legacy rows (existing empty criteria) still hydrate without throwing
  (`TASK-2633`), so `px stats` recovers while new writes stay clean.
