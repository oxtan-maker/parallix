---
id: TASK-2432
title: Stream authoritative board snapshots and progress with reconnect
status: done
assignee: [custom]
created_date: '2026-08-28 06:29'
labels:
  - user_value
  - web
  - transport
  - board
  - observability
dependencies:
  - TASK-2430
  - TASK-2431
priority: high
---

## Description

Add read-only local transport: one snapshot endpoint plus a Server-Sent Events stream for projection invalidation and operation progress. These GET endpoints are not a login or authentication surface; they retain the existing loopback-only and exact-Host boundary, have no side effects, and require no session or CSRF proof.

Reuse the existing application `BoardProjectionBuilder` and board subscription behavior. Do not add SQLite/Git/process watchers to the web adapter. Reconnect always re-establishes truth by reading a fresh snapshot; SSE/browser memory is notification state, not authority.

Keep the event model intentionally small. Prefer sending typed progress events plus “projection changed; refetch snapshot” invalidations over mirroring the whole domain as a second event-sourced store in the browser.

## Acceptance Criteria

- [ ] #1 Read-only GET returns the TASK-2430 versioned snapshot built from the same production board projection used by existing interfaces; snapshot and SSE access add no login, bearer token, session check or CSRF requirement.
- [ ] #2 SSE uses monotonically ordered event IDs within one host process and supports EventSource reconnect/Last-Event-ID behavior without duplicate user-visible log lines.
- [ ] #3 Projection changes are driven by the existing board rebuild/subscription seam; no new direct DB/Git/process polling exists in web code.
- [ ] #4 Operation progress uses the shared progress events/operation IDs from the command boundary.
- [ ] #5 A reconnect/refocus/page reload fetches a new full snapshot before trusting prior browser state.
- [ ] #6 Transient projection-build failure does not fabricate an empty board; it is surfaced and the next subscription tick can recover.
- [ ] #7 All per-client listeners, timers and streams are removed on disconnect/server close.
- [ ] #8 Any in-memory operation/event buffer is explicitly bounded and has an eviction test; no unbounded `array = [...array, event]` history is introduced.

## Agent-slop guardrails

- Do not add WebSocket infrastructure for bidirectional RPC; mutations remain POST.
- Do not add a login, account, bearer-token or remote-serving path; the existing host remains loopback-only and mutation protection belongs to TASK-2433.
- Do not persist SSE cursor/browser state as workflow state.
- Do not add a second event bus or daemon when the existing projection subscription suffices.
- Do not turn a failed projection read into zero agents/zero WIP/no work.
- Do not use real sleeps in unit tests; inject timer/clock seams.

## Definition of Done

- [ ] #1 Deterministic tests cover initial snapshot, change invalidation, progress ordering, reconnect/dedup, transient rebuild error and disconnect cleanup.
- [ ] #2 A high-volume synthetic progress test proves bounded memory/listener counts without real agent processes.
- [ ] #3 Verification/static-analysis gates pass.
- [ ] #4 Final checkpoint proves no presentation adapter reads SQLite/Git/processes directly.
