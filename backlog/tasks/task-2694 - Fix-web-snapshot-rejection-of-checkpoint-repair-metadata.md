---
id: TASK-2694
title: Fix web snapshot rejection of checkpoint repair metadata
status: backlog
assignee: []
created_date: '2026-10-09 05:29'
labels:
  - bug
  - web
dependencies: []
priority: high
ordinal: 198008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The web board fails snapshot validation after checkpoint evidence is recorded for a rebound repair. Error: snapshot.stages[2].cards[1].checkpointEvidence.checkpointEvidence[2].goalCheck[0]: unexpected key "recordedRound". Reproduced with toWebBoardSnapshot(makeProjection({active:[makeFullCard({checkpointEvidence:[{name:"CP-3",description:"repair",goalCheck:[{criterion:"criterion",evidence:"src/x.ts:1",recordedRound:3}]}]})]})) followed by validateWebBoardSnapshot: invalid-payload.

Root cause predates TASK-2692 and TASK-2693: TASK-2665 commit 5215125e2d added recordedRound to domain/persisted Goal Check rows, while src/interfaces/web/transport-projection.ts forwards checkpointEvidence unchanged and src/interfaces/web/transport-shape-checks.ts permits only criterion/evidence. Both missions inherit those files unchanged. New checkpoint writes expose the mismatch. Other domain repair fields (repairedGate/repairedGates) can leak similarly.

Explicitly project only documented WebGoalCheckRow fields at the web transport boundary; retain internal review-round and repair provenance in durable state. Do not loosen unknown-key validation or remove persisted evidence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retain a focused reproduction in the existing web transport owning suite that fails on parent behavior for stamped checkpoint repair evidence.
- [ ] #2 Snapshots containing recordedRound, repairedGate and repairedGates in domain checkpoint rows validate after projection; wire rows contain only criterion and evidence, with durable metadata unchanged.
- [ ] #3 Unrelated unknown wire keys remain rejected; ordinary and empty checkpoint evidence retain their current behavior.
- [ ] #4 Run focused transport/client checks, static analysis and a manual isolated web snapshot smoke test without modifying operator mission data.
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
