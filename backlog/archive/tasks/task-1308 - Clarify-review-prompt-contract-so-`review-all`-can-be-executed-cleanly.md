---
id: TASK-1308
title: Clarify review prompt contract so `$review all` can be executed cleanly
status: backlog
assignee: []
created_date: '2026-06-14 15:58'
updated_date: '2026-06-15 20:39'
labels:
  - ai_sdlc
  - docs
dependencies: []
documentation:
  - docs/agent-prompts/review.md
  - AGENTS.md
  - parallix/README.md
priority: medium
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The current review prompt mixes a no-execution stance with required workflow steps such as `--verify` and diff inspection. Tighten the prompt so it clearly states which commands must run, which outputs must be written, and when a reviewer should stop versus continue so future review agents can execute the workflow without ambiguity.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Review prompt explicitly distinguishes review-mode no-repo-edit constraints from required command execution steps.
- [ ] #2 Prompt tells the reviewer exactly which verification and diff-inspection commands are mandatory.
- [ ] #3 Prompt specifies the required artifact paths and the legacy verdict mapping without conflicting terminology.
<!-- AC:END -->
