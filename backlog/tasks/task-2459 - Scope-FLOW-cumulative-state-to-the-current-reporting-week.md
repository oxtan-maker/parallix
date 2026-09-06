---
id: TASK-2459
title: Scope FLOW cumulative state to the current reporting week
status: backlog
assignee: []
created_date: '2026-08-31 00:00'
labels:
  - bug
  - board
  - observability
  - web
  - user_value
dependencies:
  - TASK-2435
priority: high
---

## Description

The web FLOW chart is scoped to the current seven-day decision window, but the
projected `cumulativeFlowByState` series is an all-history state stock. A
week's first point can therefore contain every mission completed before that
week in `done`, making the done band start high and dominate the visualization.

Make the projection own a weekly cumulative-flow series whose semantics match
the reporting window used by `px stats` and FLOW. The browser must render the
published weekly series directly; it must not subtract, rebase, or otherwise
reinterpret historical lane counts.

## Acceptance Criteria

- [ ] #1 The board projection publishes a cumulative-flow series explicitly scoped to its current rolling seven-day reporting window, including that window's label and bounds.
- [ ] #2 The first weekly point contains no completed-mission accumulation from before the reporting window; a mission completed before the window cannot contribute to the week's `done` band.
- [ ] #3 Lane movement that occurs inside the window is represented from recorded lifecycle facts only. Missing history remains explicitly unavailable or estimated according to the metric contract; no chart points or transitions are fabricated.
- [ ] #4 `px stats` and FLOW use the same injected clock and the same inclusive UTC calendar-day window semantics.
- [ ] #5 The web transport carries the server-owned weekly series and the browser renders it without client-side rebasing or lifecycle inference.

## Definition of Done

- [ ] #1 Projection tests cover pre-window completed missions, an in-window completion, an in-window lane transition, and missing-history behavior.
- [ ] #2 Transport and browser rendering tests prove the pre-window done population is absent from the displayed weekly series.
- [ ] #3 `npm test -- --unit-test-headroom` and `./scripts/verify-local.sh static-analysis` pass.
