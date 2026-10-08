---
id: TASK-2662
title: Align checkpoint evidence validation and agent guidance
status: done
assignee: [custom]
created_date: '2026-10-06 10:33'
labels: []
dependencies: []
priority: medium
ordinal: 171008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2657 integration repair passed, but re-review handoff rejected CP-5 because its evidence cited web-board-interaction.cases.ts as a basename rather than an existing repository-relative path. After correcting paths, a second rejection exposed six final-checkpoint rows for eight completed criteria. Re-recording eight criterion-specific rows allowed handoff to pass.

Review checkpoint controls and agent guidance to reduce avoidable late failures without weakening evidence or approval requirements. Checkpoint recording currently validates nonblank text, while handoff validates references and final row count. Exact test-name discovery scans .test/.spec files and misses owning .cases.ts modules. Execute guidance repeats evidence rules and claims criterion-text matching that the current handoff implements as a row-count check. Reviewer guidance also claims every checkpoint reference was checked although the recorded-evidence path checks the final checkpoint.

Inspect src/application/mission-checkpoint-service.ts, src/application/static-evidence.ts, src/application/handoff-command-use-case.ts, prompts/execute-core.md, and src/adapters/review/review-prompts.ts. Confirm which repeated checks are active and useful; the duplicate static-review helper had no production callers at inspection time. Prefer shared validation and actionable diagnostics over adding another control. Reference validation needs filesystem access through existing typed ports and adapter boundaries; present any required architectural change for explicit decision before implementation.

Keep fresh independent review after tracked integration repairs and retain verifiable evidence requirements. This task is about earlier feedback, supported evidence forms, accurate concise instructions, and removal of demonstrated redundant or obsolete controls, not bypassing gates.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Recording provides actionable feedback for unsupported evidence references using the existing authority and adapter boundaries; recording and handoff share reference semantics without introducing competing validators.
- [ ] #2 Exact test-name references in supported owning case modules are recognized, with focused regression coverage for valid references and rejected nonexistent references.
- [ ] #3 Agent guidance clearly requires repository-relative paths or quoted discoverable test names, gives one concrete recording example, and accurately describes final-checkpoint coverage and executed validation.
- [ ] #4 Active duplicated controls are measured and consolidated only where equivalent; unused legacy helpers are assessed separately. Evidence requirements and fresh approval after tracked repairs remain intact.
- [ ] #5 Retain focused regressions for the TASK-2657 basename and insufficient final-row failure modes; extend the owning suites, run focused checks and required static analysis, and run docs verification for live documentation changes.
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
