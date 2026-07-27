---
id: TASK-2308
title: >-
  Ink TUI wave 6: flow analytics panel (CFD, cycle time, throughput, bottleneck
  read)
status: done
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

DESIGN CORRECTION: the artifact at `/tmp/Parallix Kanban Board Controller.zip` does not describe FLOW as an isolated stats box. For this mission only, the required design scope is the FLOW-specific behavior and hierarchy: a top-bar toggle (`▤ FLOW`) that reveals an expanded analytics region between the existing strip chrome and the board, with three coordinated parts in that region: the cumulative-flow view with legend, the median-cycle-time/per-state readout, and the bottleneck/read narrative. This wave must not expand into unrelated redesign of the rest of the board chrome.

DEPENDENCY REALITY: `BoardMetrics` exists (`src/application/projections/metrics.ts`) but TASK-2302 only READS the generic `operational_history` table; the typed lane-transition event schema and the recording write path are TASK-2303. Until TASK-2303 lands, every series legitimately reports its `missingHistoryFallback`. This wave therefore depends on TASK-2303 so the panel ships against real data, and it must render explicit missing-history states rather than estimating, back-filling, or inventing a series.

DELIVERABLE: terminal-appropriate renderings of the artifact's flow-expansion region: the four metric series, the cumulative-flow legend, median-cycle-time/per-lane-age readouts, and the derived bottleneck sentence — all computed in the application projection, not in components. The shell owns only FLOW-specific placement and toggle behavior; the metrics projection owns values and narrative. Charts degrade to a legible textual form on narrow terminals without inventing unavailable history.

NON-GOALS: new metric computation beyond what the projection exposes, writing events (TASK-2303 owns that), and any change to invocation defaults (wave 7 / TASK-2309).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cumulative flow, median cycle time per state, throughput, and review-loop rate render from `BoardMetrics` with no metric arithmetic inside components
- [ ] #1a The FLOW section follows the artifact's mission-scoped interaction model: a top-bar affordance and an expanded panel placed above the board rather than an unrelated standalone box
- [ ] #2 A series with incomplete history renders its declared `missingHistoryFallback` explicitly (null/estimate/skip) and never displays an invented or back-filled value
- [ ] #3 Per-lane median age and the existing agent-availability facts used by the FLOW view render from the projection, including an explicit unavailable state
- [ ] #3a The expanded FLOW region renders the artifact's three-part hierarchy: cumulative-flow view with legend, cycle-time/per-lane-age state readouts, and bottleneck/read narrative
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
