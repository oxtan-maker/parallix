---
id: TASK-2864
title: >-
  Make px review advance a mission with an unverified review-preparation repair
  and a pending integration repair
status: done
assignee: [claude]
created_date: '2026-11-20 15:19'
updated_date: '2026-11-20 16:40'
labels:
  - bug
dependencies: []
references:
  - TASK-2831
  - TASK-2642
  - px-0074.02
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px review is the one command that must carry a mission from any persisted state to its next action: from the recorded Mission it decides what is owed, runs it, and either advances or stops with an actionable reason. A state that ends in an internal dead-end error is a defect in that contract, whatever the local cause. Fix the contract for the state below; do not add an operator step, a manual database edit or another command.

Observed on px-0074.02 on 2026-11-20: Mission active, review round 2 approved, CP-3 a review-preparation repair (attempt 1 of 2, verified false, evidence recorded) and CP-4 a verified integration unit-gate repair that is awaiting approval retention. px status reports "review:submit for px-0074.02 failed: Original repair evidence is unavailable". px checkpoint check reports ready with no findings, so review preparation is owed and has not run. The operator reports this state used to proceed.

Local cause found so far: the exact-evidence step in src/application/integrate/repair-resumption.ts (verifyExactRepairEvidence) reads retained evidence for every repair.command of the unverified obligations, including the workflow label review-preparation (NON_GATE_REPAIR_COMMANDS in src/domain/repair-coverage.ts), for which no evidence is ever retained. It runs before review preparation can verify CP-3. The lookup cause is lost in the rewrapped message.

Required outcome: px review on this state runs the owed review preparation, verifies CP-3 through its existing owner, assesses integration approval retention through the existing integration owners, and ends at the correct next action. The contract must hold for the state class (any unverified non-gate repair alongside a pending integration approval-retention repair), not only this mission.

Regression question: find which change made this state stop proceeding. Candidates are 3bc9c59a6 (task-2859.12, 2026-11-19, moved the loop into verifyExactRepairEvidence and put the fixedVerificationNextAction repair gate in front of it), 2c197801d (px-0074.01, 2026-11-20, review-loop routing) and e8647b2ad (2026-11-03, original exact-evidence loop). Bisect with a focused reproduction through the real review loop. If a change regressed it, roll that behavior back in its owners rather than layering new code; otherwise make the smallest fix in the existing owner (isRetainedGateRepair already encodes the gate versus label distinction).

Out of scope: weakening the exact-evidence check for real gate commands, fabricating receipts or marking checkpoints verified outside their owners, editing Mission, history or statistics rows, changing gates or CPU budgets.
<!-- SECTION:DESCRIPTION:END -->

## Bisect result

Introduced by e8647b2ad (task-2831, 2026-11-03, Resume approved integration repairs through direct review): it added the retained-evidence read of `obligations.at(-1).repair.command` to `certifyPendingIntegrationRepair` and started passing `retainedRepairPort` from `src/composition/integration-repair-continuation.ts`. A lone `review-preparation` label checkpoint is a legacy scalar repair, so it failed at that commit and at 8dbe7b893^ (px-0063, 2026-11-16), which only widened the read to every distinct command. 3bc9c59a6 (task-2859.12) and 2c197801d (px-0074.01) only moved and narrowed the path; neither made the state reachable, so nothing earlier worked and no routing change is rolled back.

Fix, in the existing owners and with the existing `isRetainedGateRepair` predicate rather than a new filter owner: `verifyExactRepairEvidence` (`src/application/integrate/repair-resumption.ts`) reads and exact-verifies only gate obligations and keeps the lookup error in its failure text; the "original authorized verifier" guard in `verifyRestartedRepair` (`src/application/integrate/repair-certification.ts`) no longer demands a configured gate for a workflow label, so the configured phase rerun certifies the label checkpoint. Reproduced red on the parent (`Original repair evidence is unavailable`) with the unit case in `test/unit/application/review-loop/review-repair-evidence-contract.test.ts`.

Manual demonstration (disposable fixture, public `px review task-demo` through `run`): px-0074.02 shape (unverified `review-preparation` checkpoint plus pending integration approval-retention repair) fails on the parent source with `Original repair evidence is unavailable`; with the fix it runs the integration gate, verifies the label checkpoint, retains the approval and prints `Original approval retained for task-demo; human px integrate is required to land.` A control with a real gate checkpoint and no retained capture still exits 1 with `Original repair evidence is unavailable: Retained evidence unavailable: missing`.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused regression through the real review loop in the existing owning suite fails on the parent and passes after the fix: a mission with an unverified review-preparation repair, a verified integration gate repair and a pending approval retention, run through px review, executes review preparation, verifies the repair and reaches the correct next action with no operator step.
- [ ] #2 The same behavior holds for the state class: an unverified non-gate repair alongside a pending integration approval-retention repair, including a failing review preparation that stops with an actionable reason instead of the evidence-read error.
- [ ] #3 The change that stopped this state from proceeding is identified by bisect and recorded in the task evidence, and a regression is rolled back in its owner instead of extended.
- [ ] #4 Real gate-command obligations still fail closed with the original structured failure when retained evidence is missing, expired, incomplete or mismatched, and the failure text names the underlying lookup error.
- [ ] #5 A manual demonstration in disposable isolated state shows px review carrying the px-0074.02 shape to its next action without touching real Mission, history or statistics data.
<!-- AC:END -->



## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
