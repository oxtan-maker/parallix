---
id: TASK-2802
title: Avoid replaying superseded retained repair checkpoints
status: backlog
assignee: []
created_date: '2026-10-20 18:57'
labels:
  - bug
dependencies: []
priority: high
ordinal: 281008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Public task-2788 state active80 retains historical CP-5 browser repair incident eeac2ef0-c955-4688-885b-d5e1b1215eb1 attempt2 verified=false while newer CP-6 incident ad4af0c9-2bc1-4c10-acc7-606df10dd259 is verified=true after all11 integration gates passed274s. Pending round5 reviewercustom. src/application/review-loop/retained-repair.ts:8-9 scans backward for any unverified checkpoint, thereby selectingCP5; resumeRetainedRepair then reads old failure and launches diagnostic before normal review. Pure in-process probe with two isolated checkpoint objects reproduces selectedCP5 despite newest verifiedCP6; no operator DB mutations. Extend existing test/unit/application/review-gate-repair-contract.test.ts retained verification repair continuation owner. Existing TASK2796 was checked: locked scope covers precise non-gate rebase diagnostics and current-versus-historical evidence in prompts; explicitly excludes redesigning Mission evidence history. This is a distinct lifecycle selection bug. Preserve old historical failure rows, truthful proof provenance, current unresolved repairs, changed-authority refusal and independent review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Retained owning regression fails on parent: a newer verified incident for the same obligation and compatible locked authority prevents automatic replay of an older superseded unverified incident. Historical records remain unchanged.
- [ ] #2 Unresolved current incidents and unrelated or incompatible obligations still require exact verification; never mark historical failures verified or accept prose as proof. Define matching/supersession using authoritative command, scope, criteria and proof provenance.
- [ ] #3 Disposable public CLI continuation advances through required handoff and independent review without launching the obsolete diagnostic; no real operator state changes, gate changes or budget changes.
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
