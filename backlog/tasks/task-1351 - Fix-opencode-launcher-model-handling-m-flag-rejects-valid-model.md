---
id: TASK-1351
title: Fix opencode launcher model handling (-m flag rejects valid model)
status: backlog
assignee: []
created_date: '2026-06-26 11:18'
labels:
  - ai_sdlc
dependencies: []
references:
  - 'lib/agents/opencode.js:115'
  - 'lib/agents/opencode.js:165'
  - workflow.config.json
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The opencode launcher passes the configured model via `-m <model>` (lib/agents/opencode.js:115). When `adapters.agents.models.custom` is set to `cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`, opencode rejects it at runtime with `Model not found: cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`, and this is treated as a hard, non-retryable error (opencode.js:165-167). The default draft-agent rotation then dead-ends on `custom` whenever mistral and codex are usage-blocked.

The model name itself is correct: the same model works fine as opencode's default when no `-m` flag is passed (observed in a working draft run that selected the "qwen (opencode)" family with no model override). So the defect is in how the model identifier is passed to / resolved by opencode via `-m`, not the model name.

Interim mitigation already applied: removed the `custom` entry from `adapters.agents.models` in workflow.config.json so the launcher omits `-m` and uses opencode's working default. This task is to restore explicit `-m` model selection by fixing the handling properly.

Investigate:
- The exact identifier opencode expects for `-m` (e.g. provider prefixing / `provider/model` form, or an alias defined in opencode's own config vs the raw model name).
- Whether buildOpencodeInvocation should translate/normalize the configured model id before passing it to `-m`.
- Whether "model not found" should remain a hard error or fall back to the opencode default when the configured `-m` model is unresolved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 px draft with adapters.agents.models.custom set to cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit launches opencode and the agent runs (no 'Model not found')
- [ ] #2 The custom model override is restored in workflow.config.json once -m handling works
- [ ] #3 A regression test covers the opencode -m model identifier handling
<!-- AC:END -->
