---
id: TASK-2430
title: Define a versioned JSON-safe web board transport contract
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - web
  - contracts
  - board
dependencies:
  - TASK-2429
references:
  - docs/adr/0054-local-web-board-adapter.md
priority: high
---

## Description

Define the browser wire DTOs and conversion tests before any HTTP routes or React components exist.

The web contract must be a projection of existing `BoardProjection`, mission activity, action availability and typed outcomes. It must be JSON-safe by construction and must preserve semantic distinctions that raw `JSON.stringify()` can destroy or omit.

Particular regression cases include: `blockedForMs === Infinity` (JSON would otherwise become `null`), unknown/unobserved liveness versus observed-none versus zero, optional versus nullable fields, projection version mismatch, and unavailable versus ineligible actions.

## Acceptance Criteria

- [ ] #1 A versioned snapshot DTO contains only JSON data: objects/arrays/strings/booleans/finite numbers/null. No Set, Map, class instance, Error, function, BigInt, `undefined`-dependent semantics or non-finite number crosses the wire.
- [ ] #2 Serialization round-trip tests preserve indefinite agent blocks without silently converting them into “unknown/null”.
- [ ] #3 Tests preserve `runningSessions: unknown` versus `0` and mission-work live/unconfirmed/stale/blocked/idle semantics.
- [ ] #4 Every rendered action has a server-owned typed kind, exact display text, executable/enabled state and reason when unavailable; the client does not need the capability registry or lane rules.
- [ ] #5 Command-result/progress DTOs are versioned/validated and cannot carry stack traces or arbitrary thrown objects to the browser.
- [ ] #6 Unsupported snapshot/transport version fails closed with an explicit incompatible-client state.
- [ ] #7 Conversion is pure and fully unit-testable; this task adds no HTTP server and no UI.

## Agent-slop guardrails

- Do not send raw `BoardProjection` just because it currently “mostly stringifies”.
- Do not stringify `Infinity` or special values into ad-hoc display text deep in React components.
- Do not duplicate attention ranking, lifecycle rules or `agentIsWorking` in the DTO converter.
- Do not remove null/unknown distinctions to simplify TypeScript.
- Do not create an overly generic RPC/schema framework; define only the board transport needed now.

## Definition of Done

- [ ] #1 Round-trip tests cover every tagged union/nullable special case used by the browser.
- [ ] #2 Static analysis and verification pass.
- [ ] #3 Final checkpoint includes a table of application fact → wire representation for all special cases.
- [ ] #4 No adapter/network code is introduced.
