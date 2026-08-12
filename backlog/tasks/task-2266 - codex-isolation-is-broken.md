---
id: TASK-2266
title: codex isolation is broken
status: backlog
assignee: [custom]
created_date: '2026-07-10 19:17'
updated_date: '2026-07-10 19:17'
labels: [ai_sdlc, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex ran the smoke test from a Parallix-created environment whose HOME had been replaced with a worktree-local directory. That hid or disrupted the operator-installed OpenCode and Pi commands. The test failure therefore reflects a Parallix Codex-launcher isolation bug, not evidence that the final repository tree fails the smoke gate.

Research how what parallix actually needs (telemetry and session isolation) should be expressed when setting up the codex harness. Then fix it
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
