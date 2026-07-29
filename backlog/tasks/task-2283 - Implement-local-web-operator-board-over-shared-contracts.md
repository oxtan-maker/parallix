---
id: TASK-2283
title: Implement local web operator board over shared contracts
status: backlog
assignee: []
created_date: '2026-07-19 00:00'
updated_date: '2026-07-29 03:53'
labels:
  - web
  - board
  - react
  - ui
dependencies:
  - TASK-2322.12
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - 'https://claude.ai/code/artifact/5f739bc8-6e14-48c7-aca6-ed9a96923432'
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a local web board as another client of the shared board projection, guarded command controller, and progress-event stream. Use the exported design for intended operator experience, not its generated architecture or exact styling.

The initial server is local-only and single-operator. It must not expose an unauthenticated network control plane, execute shell strings from the browser, or let drag/drop directly rewrite task or workflow state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 The board provides repository identity, attention rail, intake and lifecycle columns, collapsible shipped history, agent strip, WIP/cycle-flow views, mission detail, guarded actions, and operation log
- [ ] #2 UI data comes only from the versioned shared projection and event contracts; web components do not read Git, Markdown, SQLite, or subprocesses directly
- [ ] #3 Buttons and drag/drop request typed commands, display the exact resulting action, require confirmation where appropriate, and handle stale-state conflicts by refreshing
- [ ] #4 The server binds loopback by default, uses an unguessable per-launch session token and origin/CSRF protections, and rejects non-local exposure unless a future security decision authorizes it
- [ ] #5 Browser input cannot supply executable command strings, arbitrary repository paths, SQL, or asset keys outside validated application requests
- [ ] #6 Refresh/reconnect reconstructs the board and active-operation state without treating browser memory as authority
- [ ] #7 Accessibility covers keyboard operation, focus order, labels, contrast, and reduced motion
- [ ] #8 Browser tests cover the attention workflow, a harmless read, one confirmed mocked mutation, stale conflict, reconnect, and unauthorized request
- [ ] #9 The artifact's direct state override path is explicitly absent
- [ ] #10 Source, bundle, security, static-analysis, and UI-neutral boundary tests pass
- [ ] #11 Rollback removes the web entry and server without affecting CLI, TUI, or persisted authority
<!-- AC:END -->

## Implementation Plan

1. Define the loopback server and browser session threat model.
2. Implement transport adapters for projection, commands, and progress events.
3. Build the board UI from the intended information hierarchy in the artifact.
4. Add confirmations, conflict refresh, reconnect, accessibility, and security tests.

## Comments

<!-- COMMENTS:BEGIN -->
author: codex
created: 2026-07-29 03:53
---
TASK-2281 is already complete. UI implementation now begins only after TASK-2322.12 certifies ADR 0053 authority cutover and shared projection readiness.
---
<!-- COMMENTS:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Security and browser behavior have executable evidence
- [ ] #2 Static analysis and shared-boundary checks pass
- [ ] #3 Browser tests use disposable repositories and mocked effects
- [ ] #4 No public network service or remote authentication system is added
<!-- DOD:END -->
