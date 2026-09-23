---
id: TASK-2557
title: fix sandbox
status: backlog
assignee: []
created_date: '2026-09-23 04:59'
labels: []
dependencies: []
ordinal: 94008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
after parallix moved some files to db the sanbox now blocks at least codex from drafting missions,

codex
The typed mission write is currently blocked by the harness database: `px goal set` returns “attempt to write a readonly database.” I’m checking the local workflow-state location and whether a fresh status read becomes available; no contract facts have been recorded yet.
exec
/bin/bash -lc "printf '%s\\n' '--- WORKFLOW STATE ---'

fix sandboxing so drafting agents can do its work (all commands it needs)
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
