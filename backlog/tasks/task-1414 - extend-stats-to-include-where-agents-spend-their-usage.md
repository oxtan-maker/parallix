---
id: TASK-1414
title: extend stats to include where agents spend their usage
status: backlog
assignee: []
created_date: '2026-07-04 05:49'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
To get better usage of the agents we need to increase the visibility on where they spend their quotas. Make a table with columns draft, execute, review, follow-up, default, total

rows are this weeks agents having stats (models, same as in Agent performance this week table)

for custom we should calculate duration since its assumed to be a local model and clock time is what is costing us
for codex we should calculate usage
for claude we should calulate $

then write in each cells the metric for each agent and in parentis (X %). Example

claude 1$ (10%)  3$ (30%) 7$ (70%)
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
