---
id: TASK-2445
title: Prevent direct backlog activation
status: backlog
assignee: []
created_date: '2026-08-30 16:30'
labels:
  - ai_sdlc
  - bug
  - workflow
  - board
dependencies: []
priority: high
---

## Description

The lifecycle projects both `px draft <mission>` and `px active <mission>` as
enabled for a backlog mission. That lets the board advertise two mutually
exclusive next steps and lets `active` bypass the refinement stage.

The operator workflow is backlog → draft/refined → active. The Ink board
shortcut contract states the same sequence: draft moves a backlog card to
refined, then active moves a refined card to active. The current shared
projection (`availableBoardCommands`) and domain transition both instead admit
backlog → active.

Found while reconciling TASK-2434's read-only web board. The web client only
renders server-projected enabled actions, so this must be corrected at the
workflow/projection boundary rather than hidden in one UI.

## Acceptance Criteria

- [ ] #1 A backlog mission projects `draft` as its only runnable lifecycle action; `active` is ineligible.
- [ ] #2 A refined mission projects `active` as runnable and `draft` as ineligible.
- [ ] #3 The authoritative activation transition rejects a backlog mission and accepts a refined mission.
- [ ] #4 Ink and web receive identical action availability through the shared board projection.

## Definition of Done

- [ ] #1 Focused domain/projection tests cover the two intake states and the rejected direct transition.
- [ ] #2 Static-analysis passes.
