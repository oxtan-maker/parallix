---
id: TASK-2657
title: Fix web command pending state and silently ignored actions
status: backlog
assignee: []
created_date: '2026-10-06 08:24'
labels: []
dependencies: []
ordinal: 168008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make every web-board action accurately reflect whether it can be invoked,
is pending, or is blocked.

Allow independent mission requests where the existing application contract
permits them. Prevent duplicate/conflicting submissions without silently
discarding user interactions or weakening server-owned authorization.

## Context and defect to verify

Reference revision: 09dfbad1dc7fa69a15a6b747cca5e6de2eeeba51.

The reviewed Board has:
- A board-wide `sending` boolean.
- A single pending mission/action.
- An early `if (sending) return` in dispatch.
- Other projected-enabled controls that remain visibly enabled.
- Interaction paths that clear an outcome or close a confirmation before
  discovering that dispatch will do nothing.

The host awaits application dispatch, so this interval can last much longer
than the initial HTTP request setup.

Reproduce by holding mission A's command unresolved and invoking an enabled
action for mission B. Establish what each interaction displays and whether
a request reaches sendCommand.

Verify the current implementation before changing it.

## Scope and ownership

Primary production ownership:
- web/src/board.tsx
- web/src/action-button.tsx
- Direct action-bearing children, including mission-card/column components
  and the attention rail, only as needed to propagate consistent pending state.
- A small cohesive pending-command hook/module, only if useful.

Read:
- web/src/board-data.ts and the command transport contract.
- src/interfaces/web/host.ts
- src/application/controller/board-controller.ts
- Relevant downstream command authorities and existing browser tests.

Do not change:
- shell.tsx, operation-log.tsx, or snapshot synchronization.
- Session/security/bootstrap behavior.
- Server dispatch semantics, lifecycle rules, locking authorities, or persistence.
- Board's snapshot/onRefresh interface.

This mission must work with the existing callback interface and remain
compatible with the separate synchronization mission.

## Required implementation analysis

Before removing the global browser guard, trace the relevant commands through
their existing application authorities.

Identify:
- Independent commands that may overlap across missions.
- Same-mission actions that conflict.
- Any actual repository-wide exclusion.
- Any deliberately permitted interrupt/control action.

Use existing contracts and tests as authority. Do not infer that all concurrent
operations are safe merely because their mission IDs differ.

Do not create a browser scheduler or duplicate lifecycle eligibility rules.
If safe concurrency would require new application locking semantics, report
that separately and keep the affected controls explicitly blocked with a
specific reason. Do not silently enable unsafe concurrency.

## Required behavior

### 1. Scoped pending ownership

Replace the accidental board-wide request blockade with pending state scoped
to the relevant mission/request.

For verified-independent actions:
- Mission B can submit while A's request remains unresolved.
- Each request retains its own pending identity.
- Completion or failure of A cannot clear B's pending state.

Prevent duplicate and conflicting submissions synchronously, including two
invocations before React has rerendered. React state updates alone must not
be the only dispatch latch.

Different action buttons on the same mission must not bypass a conflict guard
simply because their action kinds differ.

Pending state represents an unresolved command request and its associated
refresh handling, not the entire lifetime of an agent that the request started.

### 2. One availability rule across interaction paths

Apply the same effective availability calculation to:
- Normal action buttons.
- Keyboard activation.
- Attention-rail actions.
- Drag start/drop eligibility and drop execution.
- Destructive-action confirmation.

A blocked control must be visibly and accessibly unavailable with a useful
reason, or provide explicit feedback if it is invoked through a path that
cannot be disabled. Never look enabled and silently do nothing.

Preserve the distinction between:
- Server-projected ineligible/unavailable actions.
- Temporary local pending conflicts.

Do not enable an action the server projects as unavailable.

Preserve the separate explicit confirmation required for cancellation.
Do not silently close a confirmation when its command could not be submitted.
Recheck current local availability at confirmation time; do not rely solely
on the state that existed when the panel opened.

### 3. Outcomes and cleanup belong to the correct request

Keep results attributable to their mission/action:
- One request's completion cannot announce success for another.
- A blocked or duplicate interaction must not erase useful pending/error state.
- Pending ownership is released on success, typed rejection/conflict, thrown
  network error, and refresh failure.
- A successful command must not be automatically resent because refresh failed.
- A conflict refreshes the board and requires a new deliberate user invocation.
- Unmounting or card removal must not cause stale state writes or unsafe
  focus restoration.

Preserve keyboard navigation and accessible feedback. Restore focus only when
the target still makes sense; an older request must not unexpectedly steal
focus from a newer interaction.

Use the smallest outcome representation needed. Do not build a new activity
center or redesign the board.

## Required regression tests

Extend the existing owning browser suites. Mount the relevant production
components and use deferred sendCommand/onRefresh promises so ordering is
deterministic. Helper-only and static-markup tests are insufficient.

Prove:

1. While A is unresolved, a verified-independent B action sends a second
   request and displays its own pending state.
2. Resolving A then B, and B then A, preserves the other request's state and
   attributes each result correctly.
3. Rapid duplicate invocation before rerender sends one request only.
4. Conflicting actions for the same mission cannot bypass the guard through
   different buttons or interaction surfaces.
5. Every action surface has consistent availability and feedback: ordinary
   buttons, keyboard, attention rail, drag/drop, and cancellation confirmation.
6. A confirmation opened before availability changes is safely handled when
   subsequently confirmed; no unconfirmed or duplicate cancellation occurs.
7. Server-projected disabled actions remain disabled. Server conflicts still
   trigger refresh without automatic command retry.
8. Success, typed failure, network rejection, and refresh rejection each
   release only the correct pending ownership.
9. Unmounting or removal of a card during a request produces no stale updates
   or invalid focus restoration.

Use existing allowed command combinations for concurrency fixtures, not a
test-only assumption that bypasses application constraints.

Retain a focused regression that fails on the original global-guard behavior.
Also retain proof that requests are counted at the sendCommand boundary;
a changed button label alone does not establish the fix.

## Guardrails and verification

Read AGENTS.md, scoped instructions, applicable web ADRs, and ADR 0057.
Trace behavior to its owning suite before adding test files.

Run focused command/UI regressions, then:
- ./scripts/verify-local.sh static-analysis
- Relevant existing browser build/type checks.
- ./scripts/verify-local.sh docs if live documentation changed.

Leave unnecessary full-gate reruns to Parallix. Do not introduce real agent
launches, model calls, broad dependency changes, new test infrastructure,
weakened assertions, or raised budgets.

Keep production edits within this mission's scope and repository size caps.
Do not change lifecycle or authorization rules to make UI tests pass.

## Completion evidence

Record:
- Starting/final commit identities.
- The original ignored interaction and retained failing-before/passing-after test.
- The verified concurrency and same-mission conflict policy.
- A compact interaction-coverage matrix pointing to the actual tests.
- Exact verification commands/results and any untested paths.
- Any application-level concurrency limitation discovered but not changed.

Keep findings and test evidence in the normal mission checkpoint, not a new
permanent documentation inventory.

Do not integrate or push to origin; follow the normal review workflow.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
