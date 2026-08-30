---
id: TASK-2433
title: Add the same-origin guarded typed mutation endpoint for board actions
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - web
  - controller
  - security
dependencies:
  - TASK-2429
  - TASK-2430
  - TASK-2432
priority: high
---

## Description

Expose the shared guarded board controller over one narrow local-only mutation endpoint. It uses the existing per-launch same-origin/session/CSRF capability, not a user login or reusable authentication scheme; read-only snapshot and SSE endpoints remain outside this check.

The browser sends a mission identifier plus a server-advertised typed action identifier/kind and CSRF proof. The host generates the operation ID, resolves the fresh authoritative mission/action/precondition, and dispatches through `BoardCommandController`. The browser cannot provide “current status”, capabilities, agent env overrides, argv, paths or effect options.

## Acceptance Criteria

- [ ] #1 Only POST (or the exact unsafe method selected by the ADR) can mutate; GET/SSE/static routes have no side effects.
- [ ] #2 Input uses a strict allowlist/schema; unknown fields and unsupported action kinds are rejected rather than ignored.
- [ ] #3 The host generates operation IDs and server-side capability sets; client-supplied operation/capability/current-status fields are impossible.
- [ ] #4 The server resolves the mission/action against a fresh authoritative projection/controller state immediately before dispatch and uses TASK-2425's authoritative stale guard.
- [ ] #5 An action not currently advertised/runnable for that mission is rejected even if the caller crafts the HTTP request manually.
- [ ] #6 Typed application outcomes are converted to safe wire outcomes; internal stack traces, filesystem paths and raw adapter errors are not sent by default.
- [ ] #7 Conflict returns enough structured information for the client to refetch and require a new confirmation; the server does not auto-retry.
- [ ] #8 There is no endpoint for arbitrary `px` commands, environment overrides, file reads/writes, SQL, Git refs or repository switching.

## Agent-slop guardrails

- No `exec`, `spawn('px', ...)`, shell interpolation or “command” string field.
- No generic RPC `{ method, args }` escape hatch.
- No agent override/retry endpoint copied from the mockup's `WORKFLOW_AGENT=...` action.
- No optimistic server-side projection mutation after dispatch; rebuild from authority.
- Validation failures must happen before any controller/effect call; tests assert zero calls.

## Definition of Done

- [ ] #1 Negative transport tests cover malformed JSON, unknown field, unknown action, unavailable action, stale state, bad Origin/session/CSRF and effect failure.
- [ ] #2 Happy-path test asserts one controller dispatch and one operation ID.
- [ ] #3 Verification/security/static-analysis gates pass.
- [ ] #4 Reviewer confirms there is no browser-to-shell or browser-to-adapter bypass path.
