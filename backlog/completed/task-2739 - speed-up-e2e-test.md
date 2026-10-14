---
id: TASK-2739
title: speed up e2e test
status: done
assignee: [codex]
created_date: '2026-10-14 08:37'
labels: []
dependencies: []
ordinal: 236008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
the agent e2e test is critical to defending against non-obvious bugs that break the workflow. But it also consumes a lot of resources.

record one e2e test run including the agent session
analyze that session for what we can do to make it faster without reducing the defences
implement those changes

repeat on 3 e2e test, and then again, do 2 e2e tests runs to validate and report speedup.
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
