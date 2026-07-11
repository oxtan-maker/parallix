---
id: TASK-2213
title: review stats is broken
status: backlog
assignee: []
created_date: '2026-07-11 03:53'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
the review stats is broken

Agent performance this week (2026-07-05 → 2026-07-11)
Agent family                       # missions as implementer  Average PR fix rounds to complete mission  
claude-sonnet-5                    5                          0.00                                       
custom                             1                          9.00                                       
cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit  5                          0.00                                       
gpt-5.4                            9                          0.00                                       
gpt-5.6-terra                      2                          0.00                                       
mistral                            4                          0.00       

this table is supposed to classify the completed missions into who implemented them and then for each row for those missions (and those missions only) calculate the average number of review rounds to complete.

currently the statistics are wrong
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
