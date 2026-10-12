---
id: TASK-2726
title: Add smoke fixture AGENTS.md and expose agent-smoke progress
status: done
assignee: [codex]
created_date: '2026-10-12 05:33'
labels:
  - ai_sdlc
dependencies: []
priority: medium
ordinal: 224008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
During integration validation of missions 2717 and 2724, agent-smoke appeared idle despite no local model activity. Mission 2724 had completed drafting and implementation of the disposable hello-world task, but its reviewer searched the entire filesystem for a missing AGENTS.md and blocked on disk reads. Mission 2717 was waiting for the shared custom-model lock held by 2724. Seed an AGENTS.md in the disposable smoke repository (empty is sufficient), and expose meaningful smoke progress in integration validation so operators can distinguish lock waiting, model execution, and tool execution.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The real-agent smoke fixture seeds and commits a root AGENTS.md before creating mission worktrees; an empty file is sufficient and it is available in both the base checkout and mission worktree.
- [ ] #2 Integration validation exposes agent-smoke progress for waiting for the shared model lock, drafting, implementing, and reviewing.
- [ ] #3 While an agent tool is running, smoke progress exposes the current tool command so filesystem or other tool waits are distinguishable from model activity, using existing output redaction conventions.
- [ ] #4 Progress remains observable during the running gate without waiting for the smoke subprocess to exit; existing lifecycle assertions, isolation, lock serialization, and timeout budgets are preserved.
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
