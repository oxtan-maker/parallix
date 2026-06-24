---
id: TASK-1342
title: stats bug
status: done
assignee: [qwen]
created_date: '2026-06-24 05:31'
labels: [user_value]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
after implementing task-1339 the stats show really strange entries:

px stats task-1339
Mission telemetry by phase: task-1339
Phase      Provider  Model    Implementer  Input    Output  Cached   Tool calls  Duration (min)  Usage %  Cost ($)  
draft      —         —        —            0        0       0        0           0               0        0         
execute    openai    gpt-5.4  claude       4526019  21427   4072064  76          3               29       0         
review     openai    gpt-5.4  codex        4526019  21427   4072064  76          2               29       0         
follow-up  —         —        —            0        0       0        0           0               0        0         
default    —         —        claude       0        0       0        0           0               0        0         
total                                      9052038  42854   8144128  152         5                        0         
magnus@debian:~/code/parallix$ px stats
[INFO] Loading CSV: /home/magnus/.local/state/parallix/stats.csv
[INFO] Loaded 390 rows with headers: date, repo, mission, classification, implementer, pr_fix_rounds, provider, model, implementer_agent, reviewer_agent, stage, input_tokens, output_tokens, cached_tokens, context_tokens, tool_calls, openai_usage_before, openai_usage_after, openai_usage_delta, duration_minutes, cost_usd
Current week (2026-06-18 → 2026-06-24)
# missions  # user value missions  # AI SDLC missions  
35          3                      12                  

Previous week (2026-06-11 → 2026-06-17)
# missions  # user value missions  # AI SDLC missions  
31          5                      26                  

Agent performance this week (2026-06-18 → 2026-06-24)
Agent family     # missions as implementer  Average PR fix rounds to complete mission  
claude           11                         0.18                                       
codex            10                         0.80                                       
gemini           2                          0.00                                       
qwen (opencode)  14                         1.14                                       

Agent performance previous week (2026-06-11 → 2026-06-17)
Agent family     # missions as implementer  Average PR fix rounds to complete mission  
claude           12                         0.67                                       
codex            9                          1.44                                       
qwen (opencode)  18                         1.89                                       
magnus@debian:~/code/parallix$ 

the numbers don't add up, i.e. 3+12=! 35.

Also the claude stats are corrupted:

 px stats task-1339
Mission telemetry by phase: task-1339
Phase      Provider  Model    Implementer  Input    Output  Cached   Tool calls  Duration (min)  Usage %  Cost ($)  
draft      —         —        —            0        0       0        0           0               0        0         
execute    openai    gpt-5.4  claude       4526019  21427   4072064  76          3               29       0         
review     openai    gpt-5.4  codex        4526019  21427   4072064  76          2               29       0         
follow-up  —         —        —            0        0       0        0           0               0        0         
default    —         —        claude       0        0       0        0           0               0        0         
total                                      9052038  42854   8144128  152         5                        0         

AFAIK there is no way to even track usage on claude, it tracks on $

This mission started by claude, claude got usage capped, then qwen did a bit and was not able to finish by being to weak of an agent, and then claude finished it once usage cap timed out. This is a use case stat writing and reading and presentation needs to handle without bugs.
<!-- SECTION:DESCRIPTION:END -->
