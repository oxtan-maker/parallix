---
id: TASK-2857
title: One repair-checkpoint path for every integration gate failure
status: done
assignee: [codex]
created_date: '2026-11-16 07:13'
labels: []
dependencies: []
priority: high
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an integration gate fails, Parallix must record repair checkpoint(s) through exactly one code path, regardless of how many gates failed.

Today there are two paths. In the integration gate rebound route (src/adapters/cli/commands/integrate-gate-rebound.ts, integrationReboundContext) per-gate `repairObligations` are only supplied when MORE THAN ONE gate failed. A single failed gate takes a legacy single-checkpoint path in src/application/rebound-checkpoints.ts (prepareCheckpointRepairPrompt / openRepairCheckpointSet), keyed by command with no gateKey. Checkpoint identity, evidence capture, attempt accounting, restart certification (src/application/integrate/repair-certification.ts) and verification (runCheckpointVerification: single verify vs verifyAll) all branch on obligations.length. A future change that touches only one branch silently regresses the other; this is the risk to remove.

Desired outcome: an integration gate failure always produces one repair checkpoint per failed gate (a single failure is simply a set of one) through one opening, evidence, attempt-accounting, verification and restart-certification path. A second path is allowed only where a measured, documented need exists (e.g. performance); otherwise it is removed together with its superseded tests, preserving distinct behavioral assertions.

Existing in-flight/legacy missions that already carry single-gate repair checkpoints without a gateKey must remain resumable and certifiable.

Non-gate rebound reasons (rebase-conflict, review-preparation, hook-failure, artifact-incomplete, agent-timeout) are out of scope unless they share the duplicated branching.

Related finding (separate concern, do not silently fold in): the web checkpoint progress bar does not change when a mission returns to active after a gate failure, because a newly opened repair checkpoint is seeded with carried Goal Check rows (TASK-2755) and the board projection (checkpointEvidence in src/application/projections/mission-board.ts via isPlannedCheckpoint) therefore marks it `completed` immediately even though repair.verified and repair.evidenceRecorded are false. It is never `current`/`future`, so an N/N bar stays full. The single-path work should make that projection fix easy to verify but the fix needs its own bug reproduction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single failed integration gate opens exactly one repair checkpoint carrying its gate identity, through the same path as a multi-gate failure
- [ ] #2 Two or more failed integration gates open one repair checkpoint per failed gate through that same path
- [ ] #3 No integration-gate repair code branches between a single-gate and an aggregate flow for opening, evidence capture, attempt accounting, verification or restart certification, except where a documented measured need justifies it
- [ ] #4 Superseded single-gate implementation and its redundant tests are removed; distinct behavioral assertions are preserved in the owning suites
- [ ] #5 A mission with an existing legacy single-gate repair checkpoint lacking a gate identity still resumes and certifies correctly
- [ ] #6 A regression test proves a single-gate failure and a multi-gate failure produce equivalent checkpoint, attempt and verification behavior, so a change to one cannot bypass the other
- [ ] #7 Live documentation describing integration repair checkpoints is updated if user-facing behavior or constraints change
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
