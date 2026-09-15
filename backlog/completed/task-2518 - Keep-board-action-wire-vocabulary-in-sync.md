---
id: TASK-2518
title: Keep board action wire vocabulary in sync
status: done
assignee: [claude]
created_date: '2026-09-15'
labels: [bug, ai_sdlc]
dependencies: []
---

## Description

The board snapshot producer emits `recover:mission` for stranded active
missions. That action is not part of the board transport contract, so every
affected snapshot fails closed and the browser shows no board data.

`recover:mission` is an invented board action, not a lifecycle transition.
Remove it from the board projection, command vocabulary, and transport. A
stranded active mission must instead be routed through the existing defined
active lifecycle action, so resuming it records the normal lifecycle state
rather than advertising a one-off recovery command.

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 No board projection, board command, or web transport value emits or accepts `recover:mission`
- [ ] #2 A stranded active mission advertises the existing active lifecycle action and follows that action's normal durable transition path
- [ ] #3 Snapshot action validation and the producer cannot drift: regression coverage exercises every action kind the producer can emit and validates the resulting JSON-round-tripped snapshot
<!-- AC:END -->

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 A red-to-green regression reproduces the rejected `recover:mission` snapshot before the fix and proves the stranded-active replacement action
- [ ] #2 Static analysis passes
- [ ] #3 No focused or unannotated skipped tests were introduced
<!-- DOD:END -->
