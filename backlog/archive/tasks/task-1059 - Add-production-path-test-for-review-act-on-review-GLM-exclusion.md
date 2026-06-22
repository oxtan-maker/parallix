---
id: TASK-1059
title: Add production-path test for review/act-on-review GLM exclusion
status: backlog
assignee: []
created_date: '2026-05-07 05:01'
updated_date: '2026-06-13 18:13'
labels:
  - task-1036
  - testing
  - follow-up
dependencies: []
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tests 7-8 in task-1036 inject a custom `selectAgentFn` that reads from a temp config file. The actual production path — where `startReviewLoop` calls `startAgentFn('review', ...)` with no `selectAgentFn` override, causing the default `selectAgent` to read `CONFIG_PATH` — is not tested. Add a test that calls `startAgent` with default parameters against the actual `workflow/config/agents.json` and confirms GLM is not selected for `review` or `act-on-review`.

Origin: Review round 1 finding on task-1036 (MEDIUM).
<!-- SECTION:DESCRIPTION:END -->
