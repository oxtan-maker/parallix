---
id: TASK-1290
title: Replace qwen naming
status: backlog
assignee: []
created_date: '2026-06-13 18:19'
updated_date: '2026-06-25 16:47'
labels: []
dependencies: []
ordinal: 7750
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
replace qwen by Custom in the supported documentation and ensure the model family is autodetected and becomes persisted. Still becomes the actual model in stats even though that is a longer name than qwen.

Current implementation has qwen in stats, but I expect it to be cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit as model name after the change (since that is the current model being served by vLLM). It should of course choose something else if other models are served by a Custom API. 

Setup a px configure-custom-url that reads a OpenAI-compatible base-url and configures all models theiring in the agents config in a way that all of those models can be served by opencode.
<!-- SECTION:DESCRIPTION:END -->
