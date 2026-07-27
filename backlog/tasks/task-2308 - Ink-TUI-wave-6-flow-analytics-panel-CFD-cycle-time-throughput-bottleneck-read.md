---
id: TASK-2308
title: >-
  Ink TUI wave 6: flow analytics panel (CFD, cycle time, throughput, bottleneck
  read)
status: refined
assignee: [codex]
created_date: '2026-07-24 04:24'
labels:
  - ink
  - tui
  - react
  - ui
  - metrics
  - user_value
dependencies:
  - TASK-2307
  - TASK-2303
references:
  - src/application/projections/metrics.ts
  - docs/adr/0051-ui-neutral-application-boundary.md
  - /tmp/Parallix Kanban Board Controller.zip
priority: medium
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WAVE 6 of 7 (see TASK-2282). The design reference's FLOW panel — cumulative flow over the last 14 days, median cycle time per state, throughput per week, review→active loop rate, and the one-line bottleneck narrative — is the most data-dependent and least safety-critical part of the board, so it lands last among the feature waves.

DEPENDENCY REALITY: `BoardMetrics` exists (`src/application/projections/metrics.ts`) but TASK-2302 only READS the generic `operational_history` table; the typed lane-transition event schema and the recording write path are TASK-2303. Until TASK-2303 lands, every series legitimately reports its `missingHistoryFallback`. This wave therefore depends on TASK-2303 so the panel ships against real data, and it must render explicit missing-history states rather than estimating, back-filling, or inventing a series.

DELIVERABLE: terminal-appropriate renderings of the four metric series plus per-lane median age, the agent-availability strip, and the derived bottleneck sentence — all computed in the application projection, not in components. Charts degrade to a legible textual form on narrow terminals.

NON-GOALS: new metric computation beyond what the projection exposes, writing events (TASK-2303 owns that), and any change to invocation defaults (wave 7 / TASK-2309).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cumulative flow, median cycle time per state, throughput, and review-loop rate render from `BoardMetrics` with no metric arithmetic inside components
- [ ] #2 A series with incomplete history renders its declared `missingHistoryFallback` explicitly (null/estimate/skip) and never displays an invented or back-filled value
- [ ] #3 Per-lane median age and the agent-availability strip render from the projection, including an explicit unavailable state
- [ ] #4 The bottleneck narrative is derived in the application projection from named inputs and is covered by a test asserting the sentence for a fixed dataset
- [ ] #5 Chart rendering degrades to a legible textual form on narrow terminals and under resize
- [ ] #6 A zero-history repository renders the whole panel without crashing and states that history is missing
- [ ] #7 Component tests assert values and labels rather than snapshots alone
- [ ] #8 Headless CLI compatibility and the non-TTY Ink-isolation test remain green
- [ ] #9 `./scripts/verify-local.sh all` passes plus `static-analysis` for the changed `src/` code
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
