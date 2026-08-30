---
id: TASK-2435
title: Add truthful mission activity, attention, flow and operation visuals
status: backlog
assignee: []
created_date: '2026-08-28 06:29'
labels:
  - ai_sdlc
  - web
  - ui
  - observability
  - accessibility
dependencies:
  - TASK-2434
priority: high
---

## Description

Complete the read-side operator semantics: authoritative activity animation, agent/coordinator evidence, attention ranking, FLOW metrics/provenance, review detail and bounded operation log.

Use the GPU/fan treatment from the supplied variant as pixel perfect target to reach. Animation means **authoritative published work**, not “a process exists” and not “this card is in an in-flight lane”. Coordinator/process evidence stays separately labelled recovery evidence.

## Acceptance Criteria

- [ ] #1 Mission activity visuals are driven by projected `currentWork`/mission-activity facts: live work may animate; unconfirmed work is visibly uncertain; stale/blocked/idle work does not look actively running.
- [ ] #2 A live coordinator/session with no authoritative current work never produces a “running agent” fan/spinner claim.
- [ ] #3 Agent-family strip preserves available/blocked/countdown and “px command liveness” semantics, including unknown versus zero and unattributed family evidence.
- [ ] #4 Attention items render in server-projected order with server-projected reason/action; the client does not recalculate rank or choose a command.
- [ ] #5 FLOW/cycle/throughput/bottleneck views use actual metrics and provenance/sample-size/health semantics; no synthetic history is generated when history is unavailable.
- [ ] #6 Review round/phase/disposition/blocking detail uses dedicated projected fields where available rather than re-parsing display flags.
- [ ] #7 Operation log consumes SSE progress and is bounded; reconnect does not duplicate entries.
- [ ] #8 `prefers-reduced-motion` disables decorative motion while preserving a clear textual activity state.

## Agent-slop guardrails

- Do not sum px processes and call the result “agents”.
- Do not animate every active/review/integration card.
- Do not infer current work from lane, agent assignee, PR presence or session marker when the authoritative work projection says otherwise.
- Do not fabricate chart points/medians/weekly throughput for visual completeness.
- Do not grow the operation log without a hard bound and eviction test.

## Definition of Done

- [ ] #1 Tests cover work live/unconfirmed/stale/blocked/idle plus coordinator live/stopped/unknown independently.
- [ ] #2 Reduced-motion test proves no animation dependency is required to understand state.
- [ ] #3 Metrics tests cover healthy, partial/unavailable/no-telemetry/no-completions cases used by the projection.
- [ ] #4 Verification/static-analysis/browser-build gates pass.
