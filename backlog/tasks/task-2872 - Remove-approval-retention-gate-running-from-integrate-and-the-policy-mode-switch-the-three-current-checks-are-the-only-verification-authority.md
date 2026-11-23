---
id: TASK-2872
title: >-
  Remove approval retention, gate-running from integrate and the policy mode
  switch: the three current checks are the only verification authority
status: backlog
assignee: []
created_date: '2026-11-23 23:41'
labels:
  - bug
  - cleanup
dependencies: []
references:
  - TASK-2859
  - TASK-2867
  - ../parallix-research/research/verification-pomdp/parallix_stochastic_model.tex
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Planning container, Large by construction: refine into a wave with `px split`. The slices below are proposals; the drafter sizes and orders them.

## Problem

The verification model (../parallix-research/research/verification-pomdp/parallix_stochastic_model.tex) has one authority: merge only when agent review, integration tests and human review have all passed the current revision. A pass is a fact about a revision (Remark "why every repair attempt invalidates earlier passes"; A1; Lemma "record"). Wave 2859 decisions 1, 2, 5, 7 and slice 16 say the same: the generalized review step schedules every check, `px integrate` is the human approval and lands only when the three passes are current, and no other owner decides when verification runs.

Wave 2859 froze two pre-policy mechanisms instead of replacing them (hard rules for slices 6-10 forbid edits to approval coverage, rebase policy, integration disposition and repair routing; corner case 22 keeps "existing rebound and repair routing, unchanged"). px-0074.04 fixed admission defects only. Both mechanisms now contradict the model:

1. Approval retention, a second approval-validity authority. A red integration gate parks the approval as `approval-retention` (`currentIntegrationRepair`, src/domain/integration-repair-policy.ts). `fixedVerificationFacts` turns that into `pendingRepair`, and `fixedVerificationPriorityAction` (src/application/verification-policy/fixed-next-action.ts) returns `repair` for it before tests, agent review or human review are looked at. The only way out is `retainIntegrationApproval` (src/application/integrate/approval-retention.ts), which re-derives approval validity from a validation marker plus baseline, patch equality and a Forgejo approval standing at the judged revision, duplicating approval coverage and the gate-run records. When any piece misses, every entry returns `blocked` and prints "Integration repair assessment is unproven or the decision changed" with no cause.
2. Gate execution outside the policy. `px integrate` runs gates itself (`runRequiredLocalGates` in src/application/integrate-workflow.ts, three call sites, via `executeGatePlan` in src/application/integrate/gates.ts), and repair certification runs them again (`ensureRepairVerification` in src/application/integrate/repair-resumption.ts via `integrationRepairContinuation`, reachable from `px review` and `px active`). Only the tests action (src/application/integrate/tests-action.ts) is policy-owned.

Reproduction, px-0069: all three checks were current at 3c7016b (approval covers round 2, policy history "integration tests passed", the repair made no source change), yet the mission was stuck: gates passed, the active workflow stopped at src/application/integrate/gate-repair-closeout.ts ("Aborting before merge. Resume integration repair with px integrate"), and every `px review` printed the generic `blocked` message.

## Target behavior

- A gate failure on an approved mission is a failed tests verdict plus one repair attempt (corner case 22). After the repair, the next-action owner chooses from three current-ness facts for the exact revision: agent review (approval coverage), tests (gate-run record), human review. A repair that leaves the revision unchanged keeps the other passes; one that changes it invalidates them through approval coverage and the existing supersession record. No second assessment exists.
- `px integrate` admits only when the three passes are current and otherwise refuses naming the missing check. It never executes a gate. Exception: a missing human approval. Running `px integrate` in the console or pressing the integrate button records the human approval itself and proceeds when agent review and tests are current. That should already work; verify through a public command and fix only if it does not. What the human `--dry-run` and `--no-integration-gates` still mean is settled in checkpoint 1.
- Gates run only through the tests action (rebase first, existing gate-step owner, rebound kernel for a red run).
- A blocked or refused state always names the missing fact from recorded state.
- Pilot is always active: no `verificationPolicy.mode`, no shadow or off mode, no feature flag. `verificationPolicy.artifact` stays as data. A missing, invalid or mismatched artifact or a policy evaluation error still runs the fixed policy and records the reason (2859 shared hard rule); that is behavior, not a switch.

## Slices (proposed)

1. Checkpoint 1, consumer map. With file and symbol citations list every consumer of: `verificationPolicy.mode` and each "absent unless pilot" branch (src/application/ports/review-round.ts, verification-policy.ts, cli-workflows.ts, status-adapter.ts, src/adapters/config/verification-policy.ts, product-config.ts, src/composition/verification-policy-readers.ts, verification-statistics.ts, `px config`, docs/config.md); the `approval-retention` kind; `integrationRepairAssessment` (review round field and SQLite serialization); `continuePendingIntegrationRepair`, `certifyPendingIntegrationRepair`, `integrationRepairContinuation`, `retainIntegrationApproval`, `pendingIntegrationApproval`, `integrationRepairNeedsReview`; the three `runRequiredLocalGates` call sites. State what the three-check model replaces each with. The operator has decided: remove all of it, no deferrals, no shims. To establish with evidence: how persisted `integrationRepairAssessment` data on existing missions is handled (read-tolerant ignore, no migration, is the default; a migration needs separate operator approval) and whether the `review-required` kind also duplicates approval coverage. Record the red reproduction on the parent first.
2. Next-action owner reads only the three facts: remove the retention priority override and `pendingRepair` from `fixedVerificationPriorityAction`; extend the table-driven no-stranded-state test (W11) with repaired-in-place and repaired-with-new-revision rows.
3. Integrate never runs gates: remove the gate path from the integrate workflow and landing retry loop (and `resolveSkippableGates` if it has no other caller); admission reads recorded evidence (px-0074.04 owners).
4. Delete retention, repair certification and the mode switch after every production caller is moved: approval-retention.ts, domain/integration-approval-retention.ts, repair-resumption.ts certification, repair-certification.ts, integration-repair-continuation.ts, `resumeIntegrationAssessment` and its port, the `stop` route text in gate-repair-closeout.ts, and the mode config, parser, ports and docs text. Delete all dead code: every symbol, type, port, config key, fixture and helper that loses its last production caller. A test that exercises code with no production caller does not keep that code alive; tests that only test dead code are deleted. Tests asserting distinct behavior the replacement still owns move to the owning suite (AGENTS.md "Implementation"). Record a caller search per removed owner.
5. Projections and docs, minimally. Board, status and history stop projecting retention and assessment. Live docs change only where they now state something false (read docs/doc-standards.md first). ADRs: do not rewrite or restructure any ADR. Edit only the sentences that became false, in place, as the smallest compact edit in that ADR's existing format and voice: current decision only, no supersession note, no dated update, no history, no new sections. Candidates found so far, to confirm by grepping the removed behavior: docs/adr/0041-integration-pipeline-gates.md (Decision has integrate running the gates) and docs/adr/0059-fleet-level-recovery-supervisor.md (mentions rebound and coverage). An ADR that is still true stays untouched; checkpoint evidence lists each ADR checked and why it was or was not edited. A reviewer rejects an ADR diff larger than the sentences it had to change.

## Hard rules

2859 hard rules and W1-W20 apply, except that the rules freezing approval coverage and repair routing are lifted for exactly the retention and gate-running code named above. Still frozen: gate configuration and budgets, reviewer selection, rebase policy, approval coverage semantics (reused as the owner, not rewritten), metric meaning, migration checksums. No new statuses, phases, transitions, columns or migrations without operator approval at checkpoint 1. No flag, mode or compatibility switch added or kept for the removed behavior. Replace in place; one next-action owner; one writer per event; unknown stays unknown. Exercise through public commands with a disposable PARALLIX_HOME and a fixture mission in the px-0069 state; never touch the live database.

## Out of scope

Policy artifact, solver and estimation (TASK-2866, TASK-2867); landing mechanics, squash and Forgejo publication; the review-window action limit; the reviewer classifier; the flaky CPU-budget tests that triggered px-0069.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Approved mission, red gate, repair with no source change, green rerun: the next action is human review or integrate admission, never `repair` or `blocked` (red on the parent, green after).
- [ ] #2 Same, but the repair changes the revision: agent review and human review are due again, tests run on the new revision, nothing is retained.
- [ ] #3 `px integrate` with tests not current is refused naming tests and starts no gate process; `px review` and `px active` with a pending gate repair run no gate outside the tests action.
- [ ] #4 `px integrate` and the integrate button, with agent review and tests current and no human approval recorded, record the human approval exactly once and land.
- [ ] #5 A mission persisted with an old `integrationRepairAssessment` still loads and routes by the three facts; a config still carrying `verificationPolicy.mode` loads with the key ignored and `px config` prints no mode.
- [ ] #6 No policy artifact configured, or an invalid one: the fixed policy runs and the reason is recorded.
- [ ] #7 Every removed owner has a recorded caller search; no symbol, port, config key, fixture, helper or test is left that only served removed code.
- [ ] #8 ADR and live-doc diffs touch only sentences that became false, in the existing format; each ADR checked is listed with why it was or was not edited.
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
