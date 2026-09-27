---
id: TASK-2555
title: Stand down a review approval that no longer covers the branch
status: backlog
assignee: []
created_date: '2026-09-23 04:19'
labels:
  - workflow
  - cli
  - ai_sdlc
dependencies:
  - TASK-2543
references:
  - docs/adr/0053-operational-persistence-and-authority-boundaries.md
  - >-
    backlog/tasks/task-2543 -
    Revoke-an-unfounded-review-approval-and-return-the-mission-to-its-correct-lifecycle-state.md
priority: high
ordinal: 93008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A recorded approval can stop covering the work without anyone doing anything wrong. The reviewer approved a real revision on real evidence, and then the branch moved: a rebase onto the integration branch, a re-scope after a dependency landed, or an integration-gate repair. The approval is not unfounded, it is simply no longer about the code that would land.

The product already knows this at one point: `integrate-gate-rebound.ts` refuses the merge when the repaired revision differs from the approved one, saying the approval "covers a revision that is no longer what would land". That diagnostic is the whole of the product's awareness. Nothing before integration says it, and nothing can clear it.

### The shape this was found in

TASK-2521.04, 2026-09-22: the mission was rebased onto main after TASK-2521.03 integrated, and the operator then re-scoped it — the importer had to be rewritten against a contract rule that did not exist when it was reviewed. The database still read round 1, phase `approved`, disposition `APPROVED`, against a revision the rebase had replaced, and `missions.status` still read `integration`. Re-running the execute phase produced a fresh, fully evidenced tree under an approval that had been granted for different code, and `px status` presented that approval as current to every later reader.

The operator's options were the two TASK-2543 already names as wrong: destroy the lifecycle record with `px cancel`, or hand-edit SQLite. The mission was reviewed by copy-and-paste outside the product instead.

### How this differs from TASK-2543

TASK-2543 is an operator judging a decision unearned: a human looks at a claim, decides the reviewer never verified it, and withdraws it with a stated reason. The trigger is judgement and the input is a reason.

This is a mechanical fact about revisions. The approved revision is no longer what would land, and the product can determine that without asking anyone. Two consequences follow that TASK-2543's command does not cover:

- It should be **detected and reported**, not waited for. A mission whose approval no longer covers its branch should say so in `px status` and on the board, at the moment the branch moves, rather than at the integration gate at the end.
- The operations that move the branch — `px rebase` above all — are where the staleness is created, so that is where it should be recorded.

TASK-2543 builds the mechanism for standing a decision down while keeping it in the history. This task supplies the staleness rule and wires it to the operations that cause it, reusing that mechanism rather than adding a second one.

### Do not

Do not add a way to move a mission to an arbitrary state, and do not delete review rows: a stood-down approval stays in the history as an approval that was superseded, with the revision that superseded it. Do not treat a stale approval as a request for changes — no finding was raised, so nothing is owed a resolution; the round simply has to be reviewed again. Do not silently re-approve the new revision, and do not let an agent invoke the stand-down to clear its own way to integration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A recorded approval whose reviewed revision is no longer what the branch would land is reported as no longer covering the work, by `px status` and `px status --json`, before the integration gate is reached.
- [ ] #2 The staleness is determined from recorded revisions rather than a manual flag, so no operator input is needed to detect it.
- [ ] #3 An operation that moves the branch under an approval — `px rebase` at minimum — records that the approval no longer covers the branch at the moment it moves.
- [ ] #4 The mission can return to a reviewable state and open a new round for the new revision, through the supported path TASK-2543 introduces rather than a second mechanism.
- [ ] #5 The superseded approval stays in the review history, marked as superseded and naming the revision that superseded it; no review row is deleted.
- [ ] #6 A stale approval is not presented as requested changes, and opens no finding an implementer must resolve.
- [ ] #7 The new revision is never auto-approved, and no agent-facing prompt or automated loop path can stand an approval down.
- [ ] #8 The integration gate's existing refusal stays correct and now names the reported staleness rather than being the first place it appears.
- [ ] #9 A reproduction test covers the found shape: an approved mission whose branch is rebased reports its approval as no longer covering the work and can be re-reviewed, with the original approval still in its history.
- [ ] #10 Negative tests prove that an approval that still covers the branch is untouched, and that a refused stand-down leaves the mission, its review history and its Backlog status unchanged.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 Operator documentation explains the difference between a stale approval (the branch moved) and an unfounded one (TASK-2543), and which path applies to each.
<!-- DOD:END -->
