---
id: TASK-2304
title: 'Ink TUI wave 2: lane columns, mission cards, and responsive terminal layout'
status: backlog
assignee: [custom]
created_date: '2026-07-24 04:23'
labels:
  - ink
  - tui
  - react
  - ui
dependencies:
  - TASK-2282
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - docs/adr/0036-mission-sizing-and-dependency-wave-heuristics.md
  - /tmp/Parallix Kanban Board Controller.zip
priority: medium
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WAVE 2 of 7 (see TASK-2282 for the wave sequence). Wave 1 delivered `px ui` as a static shell (identity, WIP counts, staleness) plus the Ink runtime, build, and isolation guardrails. This wave renders the actual board content, still read-only.

DELIVERABLE: the lane columns from the design reference — backlog, refined, active, review, integrate, shipped — each with its count and its `MissionCard` rows carrying the facts the projection already provides (slug, title, lane, agent, checkpoint, gate status, next step, review/PR indication, blocking flag). Layout adapts to terminal width and height: a wide terminal shows columns side by side, a narrow terminal falls back to a single-column stacked view, and a resize re-lays out without corrupting the screen.

NON-GOALS: keyboard navigation and selection (wave 3 / TASK-2305), the attention queue (wave 4 / TASK-2306), any action or command dispatch (wave 5 / TASK-2307), analytics and cycle-time panels (wave 6 / TASK-2308). Cards render facts; they do not compute lifecycle state — anything not present on the projection is shown as unavailable rather than derived in a component.

The design reference is evidence of intended operator experience only; per ADR 0051 it does not import the artifact's component structure, local store, or direct mutation path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All six lanes render from `BoardProjection.stages` with per-lane counts matching `wipCounts`, including an explicit empty-lane message per lane
- [ ] #2 Mission cards render the card facts supplied by the projection (slug, title, agent, checkpoint, gate, next step, review/PR indication, blocking flag) and show 'unavailable' for absent sources instead of deriving a value in the component
- [ ] #3 Wide-terminal column layout and narrow-terminal single-column fallback are both covered by semantic tests at named widths, including the exact breakpoint
- [ ] #4 A terminal resize re-renders at the new dimensions without duplicated or truncated frames; a test drives at least one resize
- [ ] #5 Long titles and overflowing lanes truncate or scroll within the column rather than breaking the layout
- [ ] #6 Components remain pure over the projection: no workflow, SQL, Git, Forgejo, or subprocess calls, enforced by the wave-1 import guardrail
- [ ] #7 Component tests assert rendered semantics rather than relying only on snapshots
- [ ] #8 Headless CLI output, exit codes, and the non-TTY Ink-isolation test remain green
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
