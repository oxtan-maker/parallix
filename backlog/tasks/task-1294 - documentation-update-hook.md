---
id: TASK-1294
title: documentation update hook
status: backlog
assignee: []
created_date: '2026-06-13 18:24'
updated_date: '2026-07-02 18:12'
labels: []
dependencies: []
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ensure the draft prompt does include updating the documentation as part of the mission production assuming the documentation needs to be updated (i.e. not bugfixes and/or black box changes to parallix)
<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** make mission drafting state the conditional documentation obligation clearly enough that implementers update docs for user-visible behavior, while avoiding churn for internal-only or black-box bug fixes.

**Scope and proof:** inventory the draft prompt, mission scaffold, and handoff documentation checks; add one explicit decision rule with examples; ensure drafted missions carry the rule into their Definition of Done or scope. Add fixture-backed tests for a user-visible change and an internal bug fix.

**Checkpoints:** (1) capture current prompt/scaffold behavior and failing expectations; (2) implement the conditional rule and tests; (3) run draft-focused, documentation, and general verification.

**Stop rule:** do not make documentation mechanically mandatory for every mission or alter product behavior; request direction if the existing task classification cannot distinguish user-visible changes from internal repairs.
