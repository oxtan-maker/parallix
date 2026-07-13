---
id: TASK-2213
title: review stats is broken
status: done
assignee:
  - '@codex'
created_date: '2026-07-11 03:53'
updated_date: '2026-07-13 05:18'
labels:
  - ai_sdlc
  - bug
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Derive model attribution from stage telemetry across implementer handoffs. 2. Prefer the latest implementation-stage model and exclude reviewer-stage telemetry. 3. Add regression coverage and run the static-analysis gate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-07-13: Codex took over from @custom, reviewed round-5 changes (including the dated implementer-family attribution regression), and reran ./scripts/verify-local.sh static-analysis successfully. No additional production change was needed; task returned to review.

2026-07-13: Follow-up investigation found that family-name matching can treat a reviewer model as a custom implementer model. Stage telemetry records each fallback implementer separately, so attribution must prefer the latest implementation-stage model instead.

2026-07-13: Corrected attribution after handoffs: completed-mission model rows now come only from telemetry for the final implementer recorded on the closed integration rollup; reviewer telemetry cannot claim ownership. Focused suite (82 tests) and static-analysis gate pass.

2026-07-13: Clarification/supersession: closed: yes is only a mission-completion marker and may be a reviewer row. Attribution now uses the latest non-review implementation model row; reviewer telemetry never owns the mission. Regression added for a closed reviewer row after a Claude-to-custom handoff; focused suite (83 tests) and static-analysis pass.
<!-- SECTION:NOTES:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
