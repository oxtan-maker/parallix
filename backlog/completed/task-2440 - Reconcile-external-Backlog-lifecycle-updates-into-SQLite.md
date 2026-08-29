---
id: TASK-2440
title: Reconcile external Backlog lifecycle updates into SQLite
status: done
assignee: [codex]
created_date: '2026-08-29'
labels:
  - bug
  - user_value
dependencies: []
---

## Description

Lifecycle updates made through Backlog.md or its MCP path do not always update
the repository-scoped SQLite Mission aggregate. Reconcile those write paths so
the board's authoritative persisted lane matches the externally updated task.

## Definition of Done

- [ ] External lifecycle writes update the matching repository-scoped Mission.
- [ ] A regression test covers an external write followed by a board read.
