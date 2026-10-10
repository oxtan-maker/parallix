---
id: TASK-2713
title: Expose early read-only mission evidence checks and targeted agent guidance
status: backlog
assignee: []
created_date: '2026-10-10 09:16'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 214008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2708 stopped with an invalid locked contract, then post-execute validation reported missing CP-5 and CP-6 and launched evidence repair despite a recorded human-only blocker. px status exposes raw evidence but px --help exposes no dedicated evidence readiness check. Reuse the authoritative typed checkpoint, criterion coverage, verifiable-reference and repair-freshness policies for early feedback; distinguish incomplete evidence from an unresolved operator decision. Do not manufacture evidence or interpret prose as proof of semantic feasibility.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An agent can run a documented read-only evidence readiness check before handoff that reports all missing planned checkpoints, uncovered criteria, unverifiable references and stale repair evidence with concrete next commands and current mission version.
- [ ] #2 The check shares handoff policy and returns machine-readable diagnostics without executing gates, changing mission state, publishing, or creating repair checkpoints.
- [ ] #3 Execute and repair prompts direct agents to check readiness before declaring completion; a recorded unresolved human-only contract blocker is surfaced as the primary stop reason rather than prompting repeated evidence-only repair.
- [ ] #4 Owning contract suites cover task-2708-shaped missing CP-5 plus CP-6, retained earlier evidence, fresh repair rows, and human-only blockers; sandbox CLI verification proves the check has no lifecycle side effects.
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
