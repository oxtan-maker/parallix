---
id: TASK-2303
title: >-
  Record lifecycle lane-transition events and typed board metrics schema
status: backlog
assignee: [custom]
created_date: '2026-07-23 00:00'
labels:
  - application
  - board
  - persistence
  - observability
  - user_value
dependencies:
  - TASK-2302
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - src/adapters/sqlite/operational-history-repository.ts
  - src/adapters/sqlite/migrations/0001-initial-schema.sql
  - src/application/projections/metrics.ts
priority: medium
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The board time-series metrics (median state times, cumulative-flow, throughput, review-loop rate — TASK-2281 AC#3) derive from recorded lane-transition events. TASK-2295 created a GENERIC `operational_history` table (`event_type`, `event_data` JSON, `created_at`) with an `append()` API, and TASK-2302 READS it and honestly reports missing-history — but nothing WRITES lifecycle events into it, so the metrics stay empty. This mission supplies the write side: a typed board-event schema over `operational_history` and the recording path that emits an event when a mission changes lane.

DB MODELLING SCOPE. This is the operator-local durable-state modelling that the read missions deliberately deferred. Events are operator-local telemetry (authority: operator-local, role: source-of-truth for the event log itself), NOT a competing lifecycle authority — repository Git/Markdown state still wins, and a replayed event log never becomes the source of truth for a mission's current lane (ADR 0051 "operational truth over UI liveness"). The event schema records mission id, from-lane, to-lane, operation id, agent, and timestamp with immutable forward-only migration semantics matching the existing TASK-2295 migration runner and ledger.

SINGLE WRITE POINT. Emit lane-transition events from the one place the transition is already committed — the integrated application mutation use cases / `transitionTask` authority path — not scattered across command modules or UI adapters. A guardrail test fails if a second module writes board events directly. This keeps the "one code path" invariant TASK-2302 established on the read side true on the write side.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A typed lane-transition/operation board-event schema is defined over `operational_history` (mission id, from-lane, to-lane, operation id, agent, timestamp), with a forward-only migration carrying an immutable id, checksum, and ledger entry consistent with the TASK-2295 migration runner
- [ ] #2 Lane-transition events are recorded from the single integrated mutation/transition authority path; a guardrail test fails if any other module writes board events directly
- [ ] #3 The event log is operator-local telemetry only: a test proves a replayed event never overrides repository Git/Markdown lifecycle state, and event recording failure never blocks or corrupts the authoritative transition
- [ ] #4 Recording is transactional and idempotent for a given operation id; duplicate emissions do not double-count metrics
- [ ] #5 The TASK-2281 metrics (median state times, cumulative-flow, throughput, review-loop rate) compute from recorded events and move from missing-history to populated, verified by a fixture that records transitions then asserts metric values
- [ ] #6 Clean-install and previous-schema upgrade tests pass for the new migration
- [ ] #7 `./scripts/verify-local.sh all` passes plus `./scripts/verify-local.sh static-analysis` for the changed `src/` code
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Exactly one board-event write path exists; the event log is telemetry and never a lifecycle authority
<!-- DOD:END -->
