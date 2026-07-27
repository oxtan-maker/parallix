---
id: TASK-2307
title: >-
  Ink TUI wave 5: guarded actions, confirmation, cancellation, and
  progress/operation log
status: done
assignee: [codex]
created_date: '2026-07-24 04:24'
labels:
  - ink
  - tui
  - react
  - ui
  - user_value
dependencies:
  - TASK-2306
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md
  - src/application/controller/board-controller.ts
  - src/application/controller/board-command.ts
priority: medium
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WAVE 5 of 7 (see TASK-2282). Waves 1-4 deliver a navigable, attention-ranked, strictly read-only board. This is the only wave in the sequence that can cause an effect, and it is deliberately isolated for that reason.

DELIVERABLE: the TUI submits `BoardCommandRequest` values to the existing `BoardCommandController` and renders the returned outcome. Availability comes from `BoardProjection.availableActions` plus the controller's capability registry: only `active:execute` is currently integrated, so every other action renders its documented unavailable reason (`UNAVAILABLE_CAPABILITIES`) rather than a dead or lying button. Consequential actions show the exact application command and require an explicit confirmation step. Stale-state conflicts refresh the projection and re-present the action instead of retrying blindly. Cancellation is cooperative and honours ADR 0051's safe-boundary rule: after launch, report durable partial state and direct the operator to re-query — never claim a rollback that did not happen. Progress events and the operation log render as attention/diagnostic data only.

HARD RULES (ADR 0051): the TUI never edits a task file, calls Git, or spawns a process directly; it submits commands. A progress event or a rendered board move is never treated as proof of a durable transition. Fail-closed classifications from ADR 0048 surface as failures, not as completed-looking board moves.

NON-GOALS: adding new use cases to the controller, drag/drop, analytics (wave 6 / TASK-2308), default invocation (wave 7 / TASK-2309). Actions that lack an integrated use case stay unavailable here; integrating them is separate extraction work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Available actions render from `availableActions` plus the controller capability registry; non-integrated commands show their documented unavailable reason and cannot be dispatched
- [ ] #2 Destructive or consequential actions display the exact application command and require explicit confirmation; cancelling the confirmation dispatches nothing
- [ ] #3 The TUI dispatches only through `BoardCommandController`: a guardrail test proves the TUI modules perform no task-file write, Git call, SQL, Forgejo call, or subprocess spawn
- [ ] #4 A stale-state conflict result refreshes the projection and re-presents the action rather than re-executing; a test covers a status change between request and dispatch
- [ ] #5 Cancellation before dispatch cancels; cancellation after a safe boundary reports durable partial state and directs the operator to re-query, and never reports a rollback that did not occur
- [ ] #6 Rejected, failed, and cancelled outcomes render distinctly with their operator-safe message; no failure renders as a completed board move
- [ ] #7 Progress events and the operation log render as ordered diagnostic/attention data, and a test proves a progress event alone never changes a card's lane
- [ ] #8 A PTY smoke test (wave-3 harness) covers one harmless read-only action, one confirmation cancellation, and exit, launching no real agent
- [ ] #9 Component and controller-integration tests mock application ports and execute no real workflow commands
- [ ] #10 `./scripts/verify-local.sh all` passes plus `static-analysis` for the changed `src/` code
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
