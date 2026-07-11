---
id: TASK-2208
title: evaluate pi as an agent to drive custom
status: backlog
assignee: []
created_date: '2026-07-10 07:00'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
install pi  https://pi.dev/ on the local workstation and configure it to use the same model as opencode (QuantTrio/Qwen3.6-27B-AWQ-6Bit)

research if/how to enable graphify for pi and graphify in parralix for pi

implement pi as a runner

ensure there is a configuration to change the runner for custom from opencode to pi

test the e2e test with custom with opencode, measure token usage and duration
test the e2e test with custom and pi, measure token usage and duration

look trough the ADR:s to find out the format but also include data, make a recommendation of what should be the default runner for custom
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
