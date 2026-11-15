---
id: TASK-2856
title: >-
  Expose a slim read-only provider-execution snapshot on the local web host for
  external samplers
status: backlog
assignee: []
created_date: '2026-11-15 04:40'
labels:
  - web
  - observability
dependencies: []
references:
  - src/application/projections/provider-execution.ts
  - src/interfaces/web/board-read-routes.ts
  - src/interfaces/web/host.ts
  - src/composition/board-projection.ts
  - src/interfaces/web/transport-types.ts
  - TASK-2854
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An external Prometheus exporter (repo vllmobservability, running on the same host as px web) must sample how many provider processes are running per agent family every ~10 s. Today the only transport carrying this is GET /api/board, which rebuilds the whole board projection; TASK-2854 measured 4 s warm and 16-26 s cold for that build on a populated workstation, so polling it every 10 s would both fail the deadline and burn CPU on the host being measured. Add a small read-only GET route on the existing loopback web host that returns only the existing authoritative provider-execution observation (observeProviderExecution / ProviderExecutionFacts), without building the board, analytics or workflow projections.

Contract (to refine at implementation): response carries observedAt, per-mission or aggregated live invocations (runId, family, role, operationId), per-family running counts, and limitations/health so an observer can tell 'zero confirmed' from 'observation failed or incomplete'; a failed or budget-limited probe must never be rendered as zero. Coordinator captures, workflow operations, active missions, wrappers and waiting processes are not counted, exactly as the board counts today. Same loopback-only bind, Host check, GET-only policy; no new persistence, no collection loop, no duplicated provider-execution state machine, no CORS or remote listener. The exporter will sit beside px web, so remote access is explicitly out of scope (ADR 0054 unchanged). The route must be cheap enough to poll every 10 s without interfering with mission execution: bounded probe work (reuse the existing MAX_RUNS_PER_MISSION probe budget), no repeated full-history reads, and an explicit freshness timestamp.

Also decide and document how an operator gets a stable, discoverable port for an unattended px web (existing --port flag is sufficient if documented; do not add a discovery file unless needed).

Out of scope: any Parallix-side Prometheus exposition format, telemetry store, or sampling loop; workflow-event timing and rework analysis stay separate from sampled resource monitoring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A focused test in the existing web host/transport suite proves the route returns only provider-execution facts built from the existing observer, with per-family live counts that equal the board's agentAvailability runningSessions for the same state.
- [ ] #2 Observation failure, probe-budget exhaustion and unreadable run metadata surface as limitations/health on the response and are never reported as a zero count; covered by cases in the existing provider-execution suite.
- [ ] #3 Coordinator runs, workflow operations, wrappers and waiting processes are excluded, matching the board; legacy runs without family are reported as limitations, not counted under a guessed family.
- [ ] #4 Route is GET-only on the existing loopback host with unchanged Host/Origin policy; no new listener, persistence or timer; existing security contract tests unchanged and green.
- [ ] #5 Measured on populated state (>=900 missions): warm response p95 at most 300 ms, no synchronous Git or full-history reads added, repeated 10 s polling does not delay mission execution or other web reads. Report measured latency and CPU separately.
- [ ] #6 Docs updated: the route contract, the loopback-only constraint for external samplers, and how to run px web on a fixed --port.
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
