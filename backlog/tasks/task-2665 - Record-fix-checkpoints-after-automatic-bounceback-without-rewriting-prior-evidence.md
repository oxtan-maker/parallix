---
id: TASK-2665
title: >-
  Record fix checkpoints after automatic bounceback without rewriting prior
  evidence
status: backlog
assignee: []
created_date: '2026-10-06 11:21'
labels: []
dependencies: []
priority: medium
ordinal: 173008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Automatic integration bounceback or reviewer-requested changes return a mission to active for a bounded fix. Recording evidence for that repair must not require the implementer or operator to rewrite the entire final Goal Check table. TASK-2650 exposed this friction when re-review handoff rejected CP-4 shorthand references and all seven rows had to be submitted again.

Provide a supported repair-checkpoint workflow: retain valid earlier criterion evidence, record the fix and its focused verification in a repair checkpoint, and make handoff/re-review evaluate the resulting mission coverage consistently. Previously invalid evidence still requires correction with actionable diagnostics; do not manufacture references, silently accept invalid evidence, or discard earlier proof. Reuse authoritative Mission checkpoint state and existing typed ports and adapter boundaries.

Make this explicit in prompts used when automatic bounceback or review returns a mission to active. Tell the implementer what failed, which checkpoint to record or update, how to record fix evidence through px checkpoint record, which criteria are affected, and how to resume review. Include a concrete command example with real repository-relative references. Clarify that the checkpoint to record at this stage documents the fix and its verification; valid unrelated evidence is retained rather than manually restated. Ensure execute, automatic repair and review implementer guidance agree with actual validation semantics.

Related TASK-2662 covers shared reference validation, supported evidence forms and earlier feedback; coordinate with it without duplicating that work. Preserve fresh independent review and existing evidence requirements. Any architecture or authority-boundary change requires the explicit decision required by repository instructions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After automatic integration bounceback or reviewer-requested changes returns a mission to active, a supported repair checkpoint records the fix and focused verification while retaining valid prior criterion evidence; no full-table rewrite is required.
- [ ] #2 Handoff and re-review consistently validate mission coverage across retained evidence and the repair checkpoint, reject invalid or missing affected evidence with actionable feedback, and preserve existing evidence and fresh-review requirements.
- [ ] #3 Execute, bounceback repair and review implementer prompts explicitly identify the fix checkpoint workflow, affected criteria, a concrete px checkpoint record example with verifiable repository references, and the command to resume review; they do not instruct agents to restate unrelated valid evidence.
- [ ] #4 Focused regressions in the owning checkpoint, handoff and repair-prompt suites cover repeated repairs, retained prior evidence, invalid references and missing fix evidence; run required static analysis and docs verification for live documentation changes.
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
