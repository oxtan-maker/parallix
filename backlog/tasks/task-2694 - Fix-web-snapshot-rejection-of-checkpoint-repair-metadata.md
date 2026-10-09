---
id: TASK-2694
title: Fix web snapshot rejection of checkpoint repair metadata
status: backlog
assignee: []
created_date: '2026-10-09 05:29'
updated_date: '2026-10-09 05:30'
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
- [ ] #5 Complete an evidence-backed five-whys analysis of introduction, test coverage and required gate execution; distinguish verified causes from hypotheses and retain references to the responsible code, tests and gate records.
- [ ] #6 Implement and verify the smallest mechanical defences justified by that analysis so future domain checkpoint metadata changes cannot silently leak into the web transport; retain a production-shaped regression and prove its owning required gate selects and executes it.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Operator follow-up: prevent similar mission changes from breaking main, using a measured five-whys analysis.

Initial five-whys hypotheses (confirm with source, test and actual gate evidence):
1. Why did the board become unusable? Strict snapshot validation rejected an internal recordedRound field. Reproduction confirmed.
2. Why was an internal field on the wire? The transport directly forwarded domain checkpoint rows instead of explicitly projecting the transport contract. Source confirmed.
3. Why did a previously working field gain unexpected keys? TASK-2665 extended persisted/domain repair provenance while the web transport retained its old allowed keys. Commit attribution confirmed.
4. Why did verification miss the cross-boundary regression? Investigate whether owning transport fixtures exercise real stamped repair evidence and whether tests cover the production projection, serialization and client validation together. Do not assume tests were absent or skipped without checking.
5. Why did integration/publication admit the regression? Inspect the owning suite membership, required gate execution and coverage of this path. Distinguish a missing test from missing execution or stale build evidence; justify the smallest mechanical defence at the responsible boundary.

Implement evidence-backed defences, not just the one-key fix: explicit transport projection, a permanent production-shaped contract regression covering all repair metadata and a proof that its owning required gate selects and executes it. Consider a focused real persisted-row-to-browser snapshot contract if unit fixtures cannot cover the actual path. Preserve strict validation and finite test budgets; avoid blanket full-suite additions or disabling the validator.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
