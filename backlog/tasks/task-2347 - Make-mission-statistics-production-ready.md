---
id: TASK-2347
title: Make mission statistics production ready
status: backlog
assignee: []
created_date: '2026-08-08 00:00'
labels:
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Umbrella for the statistics correctness wave. Parallix uses lifecycle and usage
statistics to decide which workflow experiments work, so the numbers the board
shows must be trustworthy before any further visualization work is done.

A source review of the path

```
SQLite (board_lane_events + usage_statistics)
  → ConcreteMetricsReadAdapter
  → metrics.ts
  → BoardProjectionBuilder
  → BoardMetrics
  → FlowPanel
```

found defects that can reverse a conclusion rather than merely blur it:

1. Repository identity is dropped between the domain event and storage, and the
   database is operator-global, so one repository's board shows another's
   telemetry (task-2347.01).
2. Backlog entry, `integration → done` and closure never reach the event stream,
   and two competing write paths record transitions (task-2347.02).
3. Lane dwell time is credited to the state the mission moved *into*, so active
   time is reported as review time — with tests that encode the inversion
   (task-2347.03).
4. "Weekly throughput" is a lifetime count of missions with telemetry, with no
   completion filter and no time bucket; other historical series recompute the
   same constant at every instant (task-2347.04).
5. Agent execution minutes are presented as mission cycle time (task-2347.05).
6. Lane age is measured against the newest recorded event rather than now, and
   the bottleneck can be `done` (task-2347.06).
7. Recording and projection failures degrade silently into believable zeros
   (task-2347.07).
8. CLI and board implement different statistics semantics over the same
   database (task-2347.08).
9. The board discards the dimensions needed to compare experiments at all
   (task-2347.09).
10. `pr_fix_rounds` is counted from a `Review` decision field that no writer
    ever sets, so every model-labeled agent reports 0.00 average fix rounds
    (task-2347.10).

Children 01–06 and 10 are the correctness floor and should land before any new
stats UI work; 07–09 make the numbers interpretable and comparable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every child task task-2347.01 through task-2347.10 is closed or explicitly dropped with a recorded reason
- [ ] #2 A documented metric contract states, per metric, its definition, its identity key, its time predicate and its missing-data behaviour
- [ ] #3 An end-to-end test drives a mission through its full lifecycle and asserts the resulting board figures against hand-computed expectations
- [ ] #4 `./scripts/verify-local.sh all` passes on the final tree
<!-- AC:END -->

## Out of Scope

- New chart types or board layout work beyond what the child tasks require
- Exporting statistics to external analytics systems
- Multi-operator or shared-server aggregation

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
