---
id: TASK-1376
title: stats improvments
status: active
assignee: [custom]
created_date: '2026-06-27 10:42'
labels: [user_value]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
px stats task-XXXX show the correct statistics, but px stats shows custom instead of the actual model which is not what you are looking for when running local AI. When you are running local AI you are very interested in how the local model performs when you are experimenting and changing it.

Ensure the px stats shows statistic aggregated by model instead of whatever its using currently for this table:

Agent performance this week (2026-06-21 → 2026-06-27)
Agent family  # missions as implementer  Average PR fix rounds to complete mission  
claude        14                         0.79                                       
codex         8                          1.13                                       
custom        10                         0.50                                       
gemini        1                          0.00                                       
qwen          17                         1.71                                       

Agent performance previous week (2026-06-14 → 2026-06-20)
Agent family  # missions as implementer  Average PR fix rounds to complete mission  
claude        9                          0.78                                       
codex         4                          1.00                                       
qwen          16                         2.00
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [x] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->

