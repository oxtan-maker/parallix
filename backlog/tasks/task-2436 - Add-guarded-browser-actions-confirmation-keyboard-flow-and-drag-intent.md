---
id: TASK-2436
title: Add guarded browser actions, confirmation, keyboard flow and drag intent
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - web
  - ui
  - controller
  - accessibility
dependencies:
  - TASK-2433
  - TASK-2435
priority: high
---

## Description

Turn the read-only board into a controller without giving the browser lifecycle authority.

Buttons, attention Enter/action, keyboard shortcuts and drag/drop are affordances for **server-projected typed actions**. A drag never means “set state to target lane”. It is accepted only when the current card exposes a unique typed action whose documented result corresponds to that intent; otherwise the target is non-droppable and explains why.

Mutation UI uses explicit confirmation for effectful/destructive actions according to the shared policy. While a request is running the card may show pending operation state, but it stays in its authoritative lane until a refreshed snapshot changes it.

## Acceptance Criteria

- [ ] #1 Clicking/keyboard-triggering an enabled action shows the exact server-projected action/mission in confirmation and sends only the typed mutation request.
- [ ] #2 Disabled/unavailable actions remain non-dispatchable even if focused or invoked by keyboard.
- [ ] #3 Stale conflict closes/preserves the operation as failed, refetches authoritative snapshot and requires a new user confirmation; no silent retry.
- [ ] #4 Operation failure/cancellation leaves the card in authoritative state and displays the typed outcome.
- [ ] #5 Drag/drop maps only to an already-advertised typed action; there is no generic `move`, `setStatus`, `state override` or local mutation fallback.
- [ ] #6 No optimistic lane move occurs before authoritative projection refresh.
- [ ] #7 Attention rail and board selection stay synchronized without causing duplicate dispatch.
- [ ] #8 Keyboard-only operation covers rail/board focus, card/action selection, confirm/cancel, FLOW toggle, shipped toggle and help as applicable.
- [ ] #9 Focus is restored predictably after modal close, conflict refresh and action completion.
- [ ] #10 The mockup's environment-override “retry agent” action is absent unless a separately reviewed typed capability exists.
- [ ] #11 Design of components in scope is EXACTLY like "/tmp/Parallix Kanban Board Controller.zip"

## Agent-slop guardrails

- Search the final diff for `state =`, `setStatus`, `moveMission`, `handleDrop`-style local authority and prove every lifecycle change comes from snapshot replacement.
- Do not create client-side transition tables to decide drop legality.
- Do not dispatch by parsing the server's display string.
- Do not auto-confirm integration/review actions for convenience.
- Do not keep a hidden “force” path for demos/tests.

## Definition of Done

- [ ] #1 Interaction tests cover click, keyboard, invalid drop, valid typed drop intent, confirm, cancel, conflict and failed operation.
- [ ] #2 Tests assert mutation call count and payload fields, not only DOM text.
- [ ] #3 Accessibility/focus tests pass.
- [ ] #4 Verification/static-analysis/browser-build gates pass.
- [ ] #5 Reviewer explicitly confirms no direct state-override path exists.
