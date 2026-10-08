---
id: TASK-2653
title: Record each rebound repair attempt as durable recovery telemetry
status: done
assignee: [claude]
created_date: '2026-10-05 19:18'
labels:
  - observability
dependencies: []
references:
  - src/application/rebound-kernel.ts
  - src/application/ports/operation-history.ts
  - src/adapters/cli/commands/integrate-gate-rebound.ts
  - >-
    backlog/completed/task-2588 -
    Escalate-failed-rebounds-to-fresh-context-diagnostic-repair.md
  - >-
    backlog/tasks/task-2652 -
    Validate-fresh-context-rebound-recovery-by-replaying-historical-Ornith-failed-repairs.md
priority: medium
ordinal: 165008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

Parallix cannot answer "how often does a rebound repair attempt fix the failure, per strategy, context and model?" from its own records. Validating TASK-2588 (see TASK-2652) required joining Forgejo PR commit lists to Pi session transcripts and inferring outcomes, because:

- `recordRepairTelemetry` in the rebound kernel only writes a `RECOVERY_TELEMETRY` log line; the `onRepairTelemetry` hook exists but no consumer wires it.
- The only durable trace is `integration.gate-rebound` in operational history, emitted once per integration-gate bounce, without attempt number, strategy, context, agent model or outcome, and not at all for other rebound consumers (execute handoff, implementer phase, pre-review).
- `usage_statistics` does not distinguish rebound attempts from the stage they repair.

## Goal

Every completed rebound repair attempt, for every rebound consumer, leaves one durable, queryable record through the existing operational-history port, so recovery effectiveness can be measured with a query instead of a replay project.

## Scope

- One record per completed repair attempt containing at least: mission, repository, rebound reason kind and gate/area where applicable, attempt number and budget, strategy (`targeted` / `fresh-diagnostic`), context (`resumed` / `fresh`), launched agent after fallback, provider and model as reported by the agent run where available, failure fingerprint before and after, HEAD before and after, outcome (`pass` / `advance` / `rescue` / `escalate` or the kernel's equivalent), and duration.
- Reuse data the kernel already assembles in `RepairEvidence`; do not duplicate classification logic.
- Wire it once through the composition root so all rebound consumers get it; do not special-case integration gates.
- Use the existing operational-history port and event recording conventions. No new table, lifecycle state or telemetry authority unless the existing port demonstrably cannot carry the record; if so, stop and present the evidence before changing the boundary.
- Recording failures must never change recovery behavior or outcome.
- Keep the existing `integration.gate-rebound` event as is unless consolidating it is clearly simpler and loses nothing.

## Out of scope

Backfilling historical attempts, dashboards, `px stats` presentation, and any change to recovery policy or prompts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each completed rebound repair attempt from every rebound consumer produces exactly one durable operational-history record with the fields listed in Scope
- [ ] #2 Records for a targeted attempt followed by a fresh-diagnostic attempt in one occurrence are distinguishable by attempt number, strategy and context and share an occurrence identity
- [ ] #3 A failure to record telemetry is logged and does not change the rebound outcome
- [ ] #4 Unit tests in the rebound kernel's owning suite cover the record shape for pass, rescue and escalate paths using a port double
- [ ] #5 No new schema, lifecycle state or product command is introduced
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
