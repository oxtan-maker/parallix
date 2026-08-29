---
id: TASK-2425
title: Make board stale-command protection authoritative
status: done
assignee: [codex]
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - bug
  - board
  - controller
  - concurrency
dependencies: []
priority: high
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - docs/adr/0053-operational-persistence-and-authority-boundaries.md
  - docs/adr/0054-local-web-board-adapter.md
---

## Description

Fix the current stale-command guard before any browser mutation endpoint exists.

Today `BoardCommandController.dispatchWithStatus()` compares the request status with a “current” status supplied by its caller, while the TUI confirmation path supplies the pending card's same old status to both sides. A mission changing after the confirmation opens therefore cannot be rejected by that comparison.

Move stale/precondition verification to an authoritative application/composition seam. The controller must resolve the mission's current authoritative status/version immediately before the effect is accepted; UI callers must not be trusted to provide the current value.

## Acceptance Criteria

- [ ] #1 Red test: open/construct a command from status A, change authoritative mission state to B before dispatch, then confirm; result is typed `conflict` and the effect port is not called.
- [ ] #2 The status/version used for the comparison is read through an application-owned port/store/query supplied by composition, not from Ink/browser state or a second persistence reader.
- [ ] #3 The request still carries the user's observed precondition (`missionStatusAtRequest` and existing expected-version fields where applicable); the current value is never accepted from an interface.
- [ ] #4 The TUI uses the corrected API and refreshes/reconfirms after conflict without auto-retrying a mutation.
- [ ] #5 A no-change confirmation still dispatches exactly once.
- [ ] #6 Existing active execution, cancellation and typed outcomes are preserved.
- [ ] #7 No TOCTOU “fix” is implemented as “refresh projection in the UI then trust it”; the authoritative check is inside the command boundary as close as possible to mutation acceptance.

## Agent-slop guardrails

- Do not add another mission-status cache or new database reader in the interface layer.
- Do not silently convert conflict into retry/success.
- Do not catch and ignore authority-read failures; fail closed with a typed failure/unavailable outcome.
- Do not change unrelated lifecycle policy while fixing the guard.
- The regression test must prove the effect was **not** invoked, not merely assert an error string.

## Definition of Done

- [ ] #1 Red-to-green regression test demonstrably fails on the pre-fix behavior and passes after the fix.
- [ ] #2 Verification gate and static analysis pass on final tree.
- [ ] #3 No focused/unannotated skipped tests or type-safety escape hatches were introduced.
- [ ] #4 Final checkpoint cites the authoritative precondition path and the negative “effect not called” test.
- [ ] #5 Any user-visible conflict wording/docs affected by the change are updated.
