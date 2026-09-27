---
id: TASK-2552
title: Remove the retired file-based review protocol
status: backlog
assignee: []
created_date: '2026-09-22 12:00'
labels:
  - architecture
  - workflow
  - migration
dependencies:
  - TASK-2521.03
priority: high
ordinal: 88009
---

## Description

Remove the remaining production fallback that reads or writes reviewer findings, verdicts, dispositions, resolutions, and review-event exports through repository or temporary Markdown files. Review agents use `px verdict` and `px resolve`; the Review aggregate is the only durable authority.

## Acceptance Criteria

- [ ] #1 Normal review and recovery read decisions and resolutions only through supported `px`/application operations.
- [ ] #2 No production prompt, loop, or adapter asks an agent to create or parse review artifact files.
- [ ] #3 Review continuity, recovery, and provider mirroring preserve their existing lifecycle and fail-closed behavior.
- [ ] #4 Tests cover reviewer verdicts and implementer resolutions through the public CLI without file artifacts.
