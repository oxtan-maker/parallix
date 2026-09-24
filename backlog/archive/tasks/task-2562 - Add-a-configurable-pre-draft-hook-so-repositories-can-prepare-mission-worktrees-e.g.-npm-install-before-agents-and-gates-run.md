---
id: TASK-2562
title: >-
  Add a configurable pre-draft hook so repositories can prepare mission
  worktrees (e.g. npm install) before agents and gates run
status: backlog
assignee: []
created_date: '2026-09-23 08:56'
labels:
  - workflow
  - config
  - bug
dependencies: []
priority: high
ordinal: 99008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Mission worktrees are created without project dependencies. Most `parallix-task-*` worktrees have no `node_modules`; a few have a directory or a symlink to the main checkout, set up by hand. When Parallix develops itself, any gate that needs `tsx` fails in the worktree (`sh: 1: tsx: not found`). task-2553 hung after the active phase because of this (see TASK-2561 for the misreported diagnostic).

There is no configuration point to prepare a worktree. The existing command hooks are integrate-only (`adapters.integrate.preCommitCommand`, `adapters.integrate.postIntegrateCommand`, run via `src/adapters/process/post-integrate-hook.ts` and validated in `src/adapters/config/product-config.ts`).

## Proposal

- Add a pre-draft hook command in `workflow.config.json` (for example `adapters.draft.preDraftCommand`), run in the mission worktree after it is created and before any agent launches or gate runs. A non-zero exit stops the draft and is reported as an environment failure, not an implementer gate failure.
- Validate the new field in `product-config.ts` like the integrate hooks.
- Config generation (`px init` or whatever writes `workflow.config.json`) emits the entry, empty or commented, so repositories can see and fill it.
- Parallix's own `workflow.config.json` sets it to `npm ci` (or `npm install`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 workflow.config.json accepts a pre-draft hook command, validated like adapters.integrate.postIntegrateCommand
- [ ] #2 The hook runs in the new mission worktree after creation and before agent launch or any gate
- [ ] #3 A failing hook stops the draft with an environment failure and the hook output, without consuming the implementer repair budget
- [ ] #4 Generated config includes the pre-draft hook entry
- [ ] #5 Parallix's own workflow.config.json installs dependencies via the hook, so tsx is available in mission worktrees
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
