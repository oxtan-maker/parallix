---
id: TASK-1406
title: mistral stats does not capture anythine else than duration
status: backlog
assignee: []
created_date: '2026-07-02 18:13'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
example: px stats task-1403
Mission telemetry by phase: task-1403
Phase      Provider   Model                              Implementer  Input   Output  Cached  Tool calls  Duration (min)  Usage %  Cost ($)  
draft      opencode   cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit  custom       498362  11870   0       23          4               —        0         
execute    mistral    mistral                            mistral      0       0       0       0           22              —        0         
review     anthropic  claude-sonnet-5                    claude       3071    15060   993544  27          3               —        0.82      
follow-up  —          —                                  —            0       0       0       0           0               —        0         
total                                                                 501433  26930   993544  50          29              —        0.82
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
