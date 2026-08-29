---
id: TASK-2426
title: Make board capability availability match the wired production graph
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - bug
  - board
  - controller
  - architecture
dependencies:
  - TASK-2425
priority: high
---

## Description

Make the board's executable-capability reporting truthful per production controller instance.

The static capability registry currently calls intake/checkpoint/handoff integrated, while the production presentation controller is composed without those Mission services and therefore rejects them at dispatch time. Before the web client relies on projected action availability, composition and availability must agree.

Wire the already-existing Mission services needed by the already-integrated board commands, and expose one application-owned source for “this controller instance can execute kind X”. Keep workflow eligibility (mission/lane/review facts) separate from runtime capability wiring, then combine them before a UI advertises an action as runnable.

## Acceptance Criteria

- [ ] #1 Production composition supplies the existing intake/checkpoint/handoff services to the shared `BoardCommandController` when Mission authority is available.
- [ ] #2 A controller instance has a truthful capability query/registry; missing services mean not runnable and are not advertised as runnable.
- [ ] #3 Active execution behavior is unchanged and still uses the same shared controller instance.
- [ ] #4 Draft/review/approval/integration remain unavailable in this task; this mission does not “finish the matrix” by marking unimplemented actions available.
- [ ] #5 Tests cover full production wiring and a deliberately incomplete/read-only graph.
- [ ] #6 Projection/UI action availability can be built from workflow eligibility plus actual instance capability without importing concrete adapters into the interface.

## Agent-slop guardrails

- Do not duplicate the capability matrix in TUI, web, and controller.
- Do not make a capability appear available merely because a string exists in `BoardCommandKind`.
- Do not instantiate SQLite/Git/agent adapters from the UI.
- Do not enable draft/review/integrate as stubs or fake successes.
- Do not broaden this task into a generic dependency-injection framework.

## Definition of Done

- [ ] #1 Tests prove advertised/runnable capability and actual dispatch cannot disagree for the covered kinds.
- [ ] #2 Verification/static-analysis gates pass.
- [ ] #3 Final checkpoint includes both “services wired” and “services absent” evidence.
- [ ] #4 No unrelated command behavior changed.
