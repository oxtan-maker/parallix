---
id: TASK-2796
title: Preserve current rebase diagnostics and attribute repair evidence correctly
status: done
assignee: [codex]
created_date: '2026-10-20 10:14'
labels:
  - bug
dependencies: []
priority: high
ordinal: 275008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during px-0015 recovery: the current failure was latest-local-main ancestry after a completed rebase, but the fresh repair worker received a generic rebase error and old unit-gate incident d51ab995 (stale consumer citation), then investigated historical PR authorship failures. The ancestry refusal and bounded recovery policy are correct and must remain. src/adapters/review/rebase.ts:226 replaces unclassified rebase failures with rebase workflow exited with status 1, losing the detailed diagnostic emitted by verifyBaseAncestry. src/application/rebound-checkpoints.ts falls back to recoveryEvidenceForPrompt; rebound-evidence.ts selects recent[0] without matching the current failure; rebound-prompts.ts labels it Retained evidence for this failure. Preserve current diagnostic through the typed application port and distinguish unrelated prior evidence. Existing native Mission records and Backlog checked: completed TASK-2642 owns evidence-contract history, TASK-2780 classification, TASK-2792 interruption ownership; no active matching fix found. Do not weaken ancestry checks, gates or bounded recovery.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An owning regression proves a current non-gate rebase failure retains its precise diagnostic through handoff into the fresh repair prompt.
- [ ] #2 With an unrelated older unit-gate incident present, repair identifies current failure evidence accurately and labels historical records as related context; missing current capture is disclosed.
- [ ] #3 Retain latest-local-main ancestry enforcement, typed ports, secret redaction, finite recovery budgets and independent review; no verification-gate changes.
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
