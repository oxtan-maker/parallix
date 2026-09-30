---
id: TASK-2601
title: Use Mission classification for preflight and stage stats
status: done
assignee: []
created_date: '2026-09-28 04:17'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 132008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After the 2521.03 migration, `px classification set` writes classification to the Mission database. The draft completion check reads that Mission state, but other lifecycle paths still require the legacy Backlog task label.

Observed with task-2599: the draft agent recorded `user_value`, `px draft` reported a verified contract and completed successfully, and the task file still had `labels: []`. Draft telemetry then warned `Could not record draft stats ... Missing or invalid classification ... in the labels of ...task-2599...md`. Running `px active --implementer codex` in the mission worktree failed startup preflight with the same Backlog classification diagnostic and never launched the implementer. This is a workflow-wide authority mismatch, not a missing draft classification.

The missed legacy reads are `src/adapters/cli/startup-preflight.ts` (`reportBacklogClassification` calls `stats.resolveMissionClassification`), and `src/adapters/cli/commands/stats.ts` (`resolveMissionClassification` reads the task file; `recordStageStats` and `accumulateStageStats` call it). `src/adapters/cli/commands/draft-stats.ts` correctly checks stored Mission labels to complete a draft, then calls `recordStageStats`, producing the contradictory success and warning. The draft prompt already states that Mission state is authoritative. Audit the other callers of this resolver, including backfill and draft compatibility paths, for the same stale assumption.

Use the Mission database through `px` for classification after 2521.03. A Backlog task remains useful for its task details, but its classification label must not gate a classified Mission or override its value. Preserve a clearly scoped migration fallback only where an imported legacy Mission has no authoritative database classification, if that case is still supported.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A regression reproduces task-2599: Mission classification user_value, Backlog labels empty, draft succeeds, and px active startup preflight passes.
- [ ] #2 Draft and later stage measurements read classification from authoritative Mission state and record rows without requiring a mirrored Backlog label.
- [ ] #3 A conflicting or missing Backlog label never overrides a valid Mission classification; a missing or invalid Mission classification gets a clear failure.
- [ ] #4 Audit remaining classification consumers in the lifecycle and remove stale provider-file reads under the post-2521.03 database authority.
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
