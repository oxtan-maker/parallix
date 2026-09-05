---
id: TASK-2452
title: TUI WIP total counts every lane, not in-flight work
status: done
assignee: [codex]
created_date: '2026-09-02 06:00'
labels:
  - bug
  - user_value
  - tui
  - board
  - projection
dependencies: []
priority: medium
---

## Description

The Ink TUI top bar reports WIP as the sum of every lane in
`BoardProjection.wipCounts`, including backlog (intake), integration (the merge
step) and done (terminal). The reference board design counts only in-flight
missions — `refined`, `active`, `review` and `approved` (the lane this codebase
calls `integration`) — so
the TUI reports a number that grows with shipped and unstarted work and never
matches the operator's notion of work in flight.

The same defect was fixed on the web board during TASK-2437 by filtering lanes
in the browser component. That fix left two independent WIP rules in the
codebase: one in the web client, one in the TUI shell. The lane rule belongs in
the shared board projection so both surfaces read one authoritative number,
rather than being duplicated (and diverging) per interface. The web board's
architectural guard test explicitly forbids lane lifecycle rules in browser
code; that guard was widened to admit the web fix, which should be reverted once
the projection owns the count.

Reference: `Parallix Board GPU.dc.html` defines
`wipCount = missions.filter(m => ['refined','active','review','approved'].includes(m.state)).length`.

## Acceptance Criteria

- [ ] #1 The board projection exposes an authoritative in-flight WIP total; the
      lane membership rule exists in exactly one place in the codebase.
- [ ] #2 The Ink TUI top bar renders that total instead of summing all lanes.
- [ ] #3 The web board top bar consumes the same projected total; the lane rule
      is removed from browser code and the widened browser guard allowlist entry
      is removed with it.
- [ ] #4 Approved-and-awaiting-merge missions (the `integration` lane, raw
      status `approved`) are counted as in flight; a regression test pins that
      case explicitly.
- [ ] #5 Regression tests cover the TUI and the web surface asserting the same
      total for the same projection.

## Definition of Done

- [ ] #1 `./scripts/verify-local.sh all` passes with captured evidence.
- [ ] #2 No new lane-to-lifecycle rule is introduced in browser code.
