---
id: TASK-2792
title: Release workflow ownership correctly after Ctrl+C
status: backlog
assignee: []
created_date: '2026-10-20 02:34'
labels:
  - bug
dependencies: []
priority: high
ordinal: 273008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed on task-2773.06: Ctrl+C during px active returned to the shell, but subsequent px active attempts failed admission with "Another workflow owns this mission; stop it before restarting". px status reported no live px coordinator while retained history still showed a live execute-custom run in tmux. Investigate SIGINT propagation, detached terminal execution, workflow ownership cleanup, and restart diagnostics. Distinguish intentional detach from stopping work and make the operator-facing interruption behavior explicit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce the reported Ctrl+C sequence using isolated mission state and controlled child processes; retain a focused regression that fails on parent behavior and passes with the fix in the existing owning suite.
- [ ] #2 Ctrl+C produces a defined, truthful outcome for the workflow and any owned child or tmux execution; ownership is released after confirmed shutdown, or the CLI clearly reports continuing work and how to stop or attach to it.
- [ ] #3 After an interrupted workflow is confirmed stopped, px active can restart the same mission without stale ownership conflicts; mission data and retained history are preserved.
- [ ] #4 Cover interruption during admission and execution, including terminal-hosted children and repeated stop or restart attempts, without killing unrelated processes or weakening live ownership checks.
- [ ] #5 Manually exercise the CLI interruption and restart flow with isolated fixtures; update user-facing interruption guidance if needed, preserve existing gates, and follow ADR 0057 and repository CPU limits.
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
