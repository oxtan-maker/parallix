---
id: TASK-2808
title: Clear repair contract snapshots after operator-approved criterion correction
status: done
assignee: [codex]
created_date: '2026-10-22 12:06'
labels:
  - bug
  - workflow
dependencies: []
references:
  - src/application/repair-checkpoint-service.ts
  - src/application/mission-evidence-readiness.ts
priority: high
ordinal: 287008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A repair checkpoint snapshots authorized success criteria. If an operator correctly removes an impossible criterion and records correct-invalid-contract, mission-evidence readiness still compares the old snapshot forever and returns repair-contract-changed. TASK-2807 reproduces this: a pre-handoff GitHub-hosted acceptance criterion was removed because review branches cannot trigger that workflow, yet px checkpoint check remains blocked after the authorized correction and refreshed evidence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Parent-red: construct a repair checkpoint whose authorized criteria differ from current criteria and verify readiness returns repair-contract-changed before any operator correction.
- [ ] #2 Fixed-green: after correct-invalid-contract records an explicit operator decision for that repair checkpoint, readiness accepts the corrected contract snapshot and proceeds to ordinary evidence, gate, and review readiness checks.
- [ ] #3 Preserve immutable incident history, original authorized criteria, operator identity, decision, and evidence in checkpoint history.
- [ ] #4 Do not weaken gate validation, review independence, approval authority, checkpoint evidence validation, or operator-only correction authority.
- [ ] #5 Add the reproduction to the owning unit contract suite and retain it.
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
