---
id: TASK-2506
title: >-
  px integrate does not rebase the mission onto the primary branch before
  integrating
status: done
assignee: [custom]
created_date: '2026-09-14 07:22'
labels:
  - ai_sdlc
dependencies: []
priority: high
ordinal: 73006
---

## Description

While integrating task-2481, `px integrate` failed several times with "Merge conflicts detected. Rebase the mission branch before integrating." after all five integration gates had passed. The run then printed manual instructions (`px resolve-conflict` or `git rebase main`, rerun the gates, rerun `--dry-run`) and stopped.

Parallix is supposed to rebase a mission onto its primary/parent branch before integration starts. That step is gone. Today:

- `rebaseBeforeReviewRound` (`src/adapters/review/rebase.ts`) runs only at handoff (`src/application/handoff-command-use-case.ts:890`) and before review rounds (`src/adapters/review/review-loop.ts`).
- `src/adapters/cli/commands/integrate.ts` only does a probe merge (`git merge --no-commit --no-ff`). It refreshes the base and retries only when the conflicts are limited to backlog files (around line 560). Every other conflict ends at `integrate.ts:642`.

`main` keeps moving between review approval and integration, so a mission waiting in ready-for-integration drifts and conflicts at the last step. The integration gates run against a stale base, and the work has to be done again by hand.

History check: no integrate path in git history (`lib/commands/integrate.js`, `src/adapters/cli/commands/integrate-command.ts`, `integrate.ts`) calls a rebase workflow. The step was probably lost during the JS to TS move or the task-2332/task-2372 consolidation, not in one clearly visible commit. Confirm where it was dropped as part of this task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Before the probe merge and before the integration gates run, `px integrate` rebases the mission branch onto the resolved local primary/parent branch, using the same target resolution as `px rebase` (ADR 0043)
- [ ] #2 Integration gates run on the rebased branch, so gate results reflect the actual merge base
- [ ] #3 A clean rebase continues the integration with no human action; mission identity is preserved (see task-2503)
- [ ] #4 A conflicted rebase goes through the existing rebase conflict path (agent-assisted `buildRebasePrompt` / rebound kernel) instead of dead-ending with manual instructions
- [ ] #5 `--dry-run` reports whether a rebase would be needed or would conflict, without mutating the branch
- [ ] #6 A regression test covers a mission branch that is behind the primary branch with a non-backlog conflict-free change and integrates without a manual rebase
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
