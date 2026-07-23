---
id: TASK-2281
title: Build operator board projections, events, and guarded controller
status: active
assignee: [custom]
created_date: '2026-07-19 00:00'
labels:
  - application
  - board
  - architecture
  - observability
dependencies:
  - TASK-2295
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - lib/tools/backlog.ts
  - https://claude.ai/code/artifact/5f739bc8-6e14-48c7-aca6-ed9a96923432
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the UI-neutral board read model and guarded command controller that both Ink and web clients will consume. Use the exported design only for operator intent: attention-first workflow visibility, board stages, agent availability, WIP/cycle-flow signals, guarded actions, and an operation log.

The projection reads current repository authorities and operator-local event history. It does not make UI columns, drag/drop, or SQLite rows authoritative. Every mutation goes through the same validated application use case used by the CLI.

ADR 0051 initially extracts only the `active` execute-launch lifecycle and the
`stats-backfill` projection/apply boundary. This mission may expose only
mutations that already have an integrated, behavior-equivalent application use
case. Draft, checkpoint, review, act-on-findings, approve, and integrate remain
visible as unavailable capabilities with a reason until separate bounded
extraction missions land; this task must not implement, wrap command processes,
or duplicate those lifecycle policies to make the board appear complete.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 A versioned board projection represents repository identity; backlog, refined, active, review, approved/integrate, and shipped stages; checkpoints; gates; reviews; agents; attention reasons; and available actions
- [ ] #2 Attention ranking is deterministic and application-owned, prioritizing proximity to completion before severity with documented tie breakers
- [ ] #3 WIP counts, median state times, cumulative-flow data, throughput, and review-loop rate derive from recorded events with explicit missing-history behavior
- [ ] #4 A versioned command controller exposes only integrated application use cases; initially this includes the approved `active` slice, while draft, checkpoint, review, act-on-findings, approve, and integrate return explicit unavailable capability results until separately extracted
- [ ] #5 Available actions are capability results from application policy, not UI guesses
- [ ] #6 Progress events and final results share stable operation IDs and support cancellation where the underlying use case can safely cancel
- [ ] #7 A dropped or clicked card cannot directly change state; invalid and stale requests fail with typed conflict results
- [ ] #8 Repository projections are rebuildable and database conflicts never override Git or canonical task/mission documents
- [ ] #9 Unit tests cover every projection stage, attention reason, metric fallback, stale command, invalid transition, and progress-event ordering without real subprocesses
- [ ] #10 Source, bundle, static-analysis, and SQLite tests pass
- [ ] #11 A no-bypass test fails if the controller spawns a CLI command, imports a legacy command handler, writes Markdown/Git/SQLite directly, or implements a lifecycle transition not owned by an integrated application use case
<!-- AC:END -->

## Implementation Plan

1. Define versioned projection, action-capability, operation, and event types.
2. Build read adapters over current task, mission, review, gate, agent, and Git authorities.
3. Add the operator-local event history needed for time-based metrics.
4. Implement guarded dispatch only over integrated application use cases and
   explicit unavailable capabilities for every unextracted lifecycle action.
5. Prove deterministic projections and stale-command rejection.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Projection and command contracts have exact tests and version fields
- [ ] #2 Static analysis and all focused tests pass
- [ ] #3 No UI framework or HTTP transport is imported by the controller
- [ ] #4 No real agent, Forgejo, or destructive repository operation runs in unit tests
- [ ] #5 No board action bypasses or expands the ADR 0051 application boundary
<!-- DOD:END -->
