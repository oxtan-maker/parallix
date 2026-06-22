---
id: TASK-1318
title: audit stats for bugs
status: done
assignee: [qwen]
created_date: '2026-06-16 05:41'
labels: ["ai_sdlc"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
This stats does not seems credible:

Current week (2026-06-10 → 2026-06-16)
# missions  # user value missions  # AI SDLC missions  
28          5                      23                  

Previous week (2026-06-03 → 2026-06-09)
# missions  # user value missions  # AI SDLC missions  
23          5                      18                  

Agent performance this week (2026-06-10 → 2026-06-16)
Agent family     # missions as implementer  Average PR fix rounds to complete mission  
claude           11                         0.64                                       
codex            9                          0.00                                       
qwen (opencode)  15                         0.20                                       

Agent performance previous week (2026-06-03 → 2026-06-09)
Agent family     # missions as implementer  Average PR fix rounds to complete mission  
claude           6                          0.33                                       
codex            7                          0.71                                       
mistral          1                          0.00                                       
qwen (opencode)  9                          0.78          

Go through parallix and visualboard forgejo surface for the missions that are shown latest week, the PR fix rounds to complete the mission seems like cooked data.

Same thing with stats on 

px stats task-1316
Mission telemetry by phase: task-1316
Phase      Provider   Model            Implementer  Input  Output  Cached  Tool calls  Duration (min)  Usage %  
draft      —          —                —            0      0       0       0           0               0        
execute    anthropic  claude-opus-4-8  claude       1      4010    462739  4           1               0        
review     claude     claude           claude       0      0       0       0           2               0        
follow-up  —          —                —            0      0       0       0           0               0        
default    —          —                claude       0      0       0       0           0               0        
total                                               1      4010    462739  4           3       

its not realistic that claude had 1 input token, and it looks like claude reviewed itself which was defintly not the case in this mission

also somehow it was halucinated away the stats on mission cost. When we implmemented claude telemitry there where supposed to be a column with costs, that seems also be halucinated away somehow (reporting 0 for codex and opencode in that column is fine).

We need to think hard on the current stats we have, why they ended up in this state and a massive review of the stats code so that future stats will be correct.
<!-- SECTION:DESCRIPTION:END -->
