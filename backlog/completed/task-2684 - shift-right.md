---
id: TASK-2684
title: shift right
status: done
assignee: [claude]
created_date: '2026-10-07 16:17'
labels: []
dependencies: []
ordinal: 195008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CPU and integration-ci continues to be a major velocity bottleneck, check how much can be cut if we introduce a fixed constant on how large CPU limits we accept, i.e. use bisect or suitable algorithm to find the constant that cuts as much as possible of the CPU limit (as proxy for actual CPU usage which differs widely depending on how many missions run at the same thime) while keeping the sonarcube coverage bar later.

This is a shift right approach since the inteagration-ci tests will be executed later on push to github and will not be accepted in origin/main unless they pass.

Once its found, update the agent instructions (Agents.md) letting agents know that integration tests that have to have a limit larger that whats defined will not contribute to coverage, they will have to ensure coverage with cheaper tests.
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
