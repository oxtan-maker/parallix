---
id: TASK-1326
title: Add AGENTS.md to parallix repository root
status: backlog
assignee: []
created_date: '2026-06-17 04:40'
labels:
  - ai_sdlc
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Parked follow-up from task-1322 review (round 1, reviewer qwen, finding #2, severity Low).

The implementer/reviewer minimum-loop contracts instruct agents to "Load the locked mission and AGENTS.md before acting/reviewing," but no `AGENTS.md` exists at the parallix repo root (it exists in the visualBoard repos). This is a repo-wide procedural gap unrelated to the task-1322 session-not-found fix, so it was parked rather than fixed in that mission.

Action: create an `AGENTS.md` at the parallix repo root documenting the conventions agents should follow (build/test commands, gate substitutions such as `npm test` standing in for the non-existent `./scripts/verify-local.sh`, restricted areas, commit conventions). Reference visualBoard/AGENTS.md as a template.
<!-- SECTION:DESCRIPTION:END -->
