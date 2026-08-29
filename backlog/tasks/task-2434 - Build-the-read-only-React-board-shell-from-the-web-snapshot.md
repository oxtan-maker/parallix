---
id: TASK-2434
title: Build the read-only React board shell from the web snapshot
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - web
  - react
  - board
  - ui
dependencies:
  - TASK-2430
  - TASK-2432
priority: high
---

## Description

Build the browser board as a **read-only** client of the TASK-2430 snapshot. Recreate the supplied design's information hierarchy and visual language without copying its generated controller/state code.

This mission lays out the top bar, agent strip shell, attention rail shell, backlog/refined intake, active/review/integration lanes, collapsible shipped/done lane, responsive behavior and basic mission-card/detail structure. Controls may be rendered from server-projected action metadata but remain disabled/non-mutating in this task.

Use real projection values only. No hard-coded “missions/wk”, PR numbers, gate state, review rounds, agent sessions or mock missions remain in production source.

## Acceptance Criteria

- [ ] #1 Browser renders repository identity, WIP/attention/throughput when available, six authoritative lifecycle lanes, counts and collapsible done history from snapshot data.
- [ ] #2 Layout captures the visual reference (dark operator board, intake/in-flight/shipped grouping, compact cards) without copying generated `.dc.html` controller/state implementation.
- [ ] #3 Responsive desktop/narrow layouts remain usable without silently dropping lanes or actions.
- [ ] #4 Empty/unavailable/unknown facts have explicit presentation; missing data is not rendered as zero/success.
- [ ] #5 Server action display/availability can be shown, but no click/key/drop invokes the mutation endpoint in this task.
- [ ] #6 Keyboard focus order, semantic landmarks/headings, contrast and screen-reader labels are present from the first UI slice.
- [ ] #7 Client boot/version/error/loading states are explicit and do not render stale cached state as current after incompatible transport.
- [ ] #8 Design of components in scope is EXACTLY like "/tmp/Parallix Kanban Board Controller.zip"


## Agent-slop guardrails

- No local mock mission array in production code.
- No hard-coded lifecycle mapping such as `if lane === review then action = px review`.
- No imports from filesystem, SQLite, Git, child_process, Node HTTP or concrete adapters into the browser bundle.
- Use the ADR 0054 React/React DOM client. Do not add a router, browser state framework, SSR layer, or large design system without a demonstrated requirement and separate architectural approval.
- No hidden mutation handlers “for later”. This task is read-only by construction.

## Definition of Done

- [ ] #1 Component tests cover representative empty/unknown/full snapshots and narrow/wide layouts.
- [ ] #2 Browser bundle contains no Node built-in/concrete adapter imports.
- [ ] #3 Verification/static-analysis/build gates pass.
- [ ] #4 Visual fixture tests use contract fixtures, not duplicated domain rules.
