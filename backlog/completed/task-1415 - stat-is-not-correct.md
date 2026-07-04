---
id: TASK-1415
title: stat is not correct
status: done
assignee: [custom]
created_date: '2026-07-04 06:04'
labels: [user_value, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
we have had several mission to ensure the stats is correctly displaying the closed missions. Its still not working, when doing the stats before and after 1388 was closed the stats did not update at all. Find the bug(s) we still have there and fix them.

 px stats
[INFO] Loading CSV: /home/magnus/.local/state/parallix/stats.csv
[INFO] Loaded 703 rows with headers: date, repo, mission, classification, implementer, pr_fix_rounds, provider, model, implementer_agent, reviewer_agent, stage, input_tokens, output_tokens, cached_tokens, context_tokens, tool_calls, openai_usage_before, openai_usage_after, openai_usage_delta, duration_minutes, cost_usd, closed
Current week (2026-06-28 → 2026-07-04)
# missions  # user value missions  # AI SDLC missions  # unknown missions  
45          16                     29                  0                   

Previous week (2026-06-21 → 2026-06-27)
# missions  # user value missions  # AI SDLC missions  # unknown missions  
49          16                     33                  0                   

Agent performance this week (2026-06-28 → 2026-07-04)
Agent family                       # missions as implementer  Average PR fix rounds to complete mission  
claude-opus-4-8                    1                          0.00                                       
claude-sonnet-4-6                  1                          0.00                                       
claude-sonnet-5                    8                          0.00                                       
cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit  29                         0.21                                       
gpt-5.4                            1                          0.00                                       
mistral                            6                          0.00                                       

Agent performance previous week (2026-06-21 → 2026-06-27)
Agent family                       # missions as implementer  Average PR fix rounds to complete mission  
claude                             2                          0.00                                       
claude-opus-4-8                    9                          0.67                                       
codex                              1                          4.00                                       
custom                             1                          1.00                                       
cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit  20                         0.85                                       
gpt-5.4                            6                          1.17                                       
qwen                               10                         2.10                                       
magnus@debian:~/code/parallix$ px stats
[INFO] Loading CSV: /home/magnus/.local/state/parallix/stats.csv
[INFO] Loaded 708 rows with headers: date, repo, mission, classification, implementer, pr_fix_rounds, provider, model, implementer_agent, reviewer_agent, stage, input_tokens, output_tokens, cached_tokens, context_tokens, tool_calls, openai_usage_before, openai_usage_after, openai_usage_delta, duration_minutes, cost_usd, closed
Current week (2026-06-28 → 2026-07-04)
# missions  # user value missions  # AI SDLC missions  # unknown missions  
45          16                     29                  0                   

Previous week (2026-06-21 → 2026-06-27)
# missions  # user value missions  # AI SDLC missions  # unknown missions  
49          16                     33                  0                   

Agent performance this week (2026-06-28 → 2026-07-04)
Agent family                       # missions as implementer  Average PR fix rounds to complete mission  
claude-opus-4-8                    1                          0.00                                       
claude-sonnet-4-6                  1                          0.00                                       
claude-sonnet-5                    9                          0.00                                       
cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit  29                         0.21                                       
mistral                            7                          0.00                                       

Agent performance previous week (2026-06-21 → 2026-06-27)
Agent family                       # missions as implementer  Average PR fix rounds to complete mission  
claude                             2                          0.00                                       
claude-opus-4-8                    9                          0.67                                       
codex                              1                          4.00                                       
custom                             1                          1.00                                       
cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit  20                         0.85                                       
gpt-5.4                            6                          1.17                                       
qwen                               10                         2.10
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
