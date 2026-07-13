---
id: TASK-2219
title: Repair the default-suite baseline failure in integration preflight tests
status: backlog
assignee: []
created_date: '2026-07-11 07:50'
updated_date: '2026-07-11 07:50'
labels: []
dependencies: []
references:
  - test/task-1039-integrate-v3.test.js
priority: high
ordinal: 7002
---

## Description

Investigate and repair the pre-existing `printIntegrationPreflight PR approval
failures` default-suite failure, reproducing it against `main` before changing
behavior. The per-round verification gate depends on a green baseline.

## Acceptance Criteria

- [ ] The failure is reproduced on the baseline and its cause is documented.
- [ ] The default suite passes without masking the affected test.
