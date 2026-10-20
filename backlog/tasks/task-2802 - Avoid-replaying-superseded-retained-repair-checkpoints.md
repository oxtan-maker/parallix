---
id: TASK-2802
title: Reconcile historical pending repairs with newer verified incidents
status: backlog
assignee: []
created_date: '2026-10-20 18:57'
updated_date: '2026-10-20 18:58'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: codex
created: 2026-10-20 18:58
---
Authority qualification: CP-5 and CP-6 are DIFFERENT incident IDs. Both record the same browser command and byte-identical authorizedGates and nine authorizedCriteria, matching the current locked contract. Public checkpoint fields expose no captured revision, gate fingerprint or failure fingerprint. The isolated probe proves the backward scan selects historical CP-5 despite newer verified CP-6; it does NOT prove that ignoring CP-5 automatically is authorized. Incident identity and revision-bound proof may distinguish legitimate obligations. Before implementation, establish an authoritative supersession/proof rule through existing lifecycle evidence, or retain explicit unresolved classification. Do not implement latest-command-wins, mark old verified, or rewrite historical failure rows. Coordinate independent ownership analysis; TASK-2796 approval remains untouched.
---

author: codex
created: 2026-10-20 18:58
---
Independent ownership analysis: existing repair records do not contain chronology, revision-bound proof links or authoritative coverage relationships. Do not retrospectively infer latest-command-wins. Proposed minimal design for operator review: extend the existing checkpoint verification owner to record explicit coverage only from actual successful exact-check evidence, with Mission compare-and-swap; share one selector between pendingRetainedRepair and repairContractFailure. Preserve historical failures unchanged. Focused owning cases must cover an explicitly covered older incident, an uncovered distinct incident, reopening after new failure, locked-contract changes, CAS conflicts and preserved history. Activation/design decision remains pending; no implementation authorized by this note.
---
<!-- COMMENTS:END -->
