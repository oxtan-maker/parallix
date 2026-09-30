---
id: TASK-2570
title: Remove unsupported project approval settings from Codex launch config
status: done
assignee: [codex]
created_date: '2026-09-24 19:00'
labels:
  - bug
  - workflow
  - codex
dependencies: []
priority: medium
ordinal: 103008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The TASK-2521.06 recovery run on Codex v0.156.1 emitted three unrecognized-setting warnings: a session-flags projects worktree entry and two projects.<path>.approval_policy entries in .workflow/codex-home/.codex/config.toml. The repository template templates/codex/config.toml also puts approval_policy inside a projects table. Official Codex configuration documents approval_policy as a top-level key and projects.<path>.trust_level as the project key. Trace the generated launch config and template, keep the trust entries, move approval policy to the supported top-level setting or explicit launch flag, and add a regression that starts Codex without unrecognized-setting warnings. This warning was separate from the checkpoint handoff failure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Codex v0.156.1 starts from generated mission config without unrecognized-setting warnings
- [ ] #2 Generated config and template use supported key placement; a test catches project-scoped approval_policy
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
