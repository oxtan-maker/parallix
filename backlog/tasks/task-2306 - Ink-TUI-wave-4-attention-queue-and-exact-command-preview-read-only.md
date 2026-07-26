---
id: TASK-2306
title: 'Ink TUI wave 4: attention queue and exact-command preview (read-only)'
status: backlog
assignee: [custom]
created_date: '2026-07-24 04:24'
labels:
  - ink
  - tui
  - react
  - ui
  - user_value
dependencies:
  - TASK-2305
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - src/application/projections/board.ts
  - src/application/projections/mission-board.ts
  - /tmp/Parallix Kanban Board Controller.zip
priority: medium
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WAVE 4 of 7 (see TASK-2282). Waves 1-3 give a navigable, read-only board. This wave adds the attention-first surface that is the point of the design reference: the ranked "needs you next" queue.

DELIVERABLE: render `BoardProjection.attentionQueue` — rank, mission slug, reason, and the explanation of why it is ranked there — with the ranking rule stated in the UI ("closest to done first: integrate > review > active; severity breaks ties") and sourced from the existing `attentionRank`/`attentionReason` logic, not re-implemented in a component. Each attention item shows the EXACT application command an operator would run, and selecting one focuses the corresponding card on the board.

CRITICAL BOUNDARY: this wave PREVIEWS commands; it does not run them. The run affordance renders the literal command text and, when activated, reports that execution arrives in wave 5 (TASK-2307). Execution through `BoardCommandController` — with confirmation, capability guards, stale refresh, cancellation, and progress — is wave 5's whole subject and must not be pulled forward.

NON-GOALS: command dispatch, progress rendering, analytics (wave 6 / TASK-2308), default invocation (wave 7 / TASK-2309).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The attention queue renders rank, mission, reason, and why-ranked from `BoardProjection.attentionQueue`, using the shared ranking projection rather than component-local ranking logic
- [ ] #2 An empty attention queue and a queue whose items reference missing or unavailable sources both render explicitly instead of appearing as an empty panel
- [ ] #3 Each attention item displays the exact application command text an operator would run, matching the command the controller would receive
- [ ] #4 Selecting an attention item focuses the corresponding card in the lane view and vice versa; the two surfaces never disagree about the selected mission
- [ ] #5 No command executes in this wave: a test proves activating the run affordance dispatches nothing and reports that execution lands in TASK-2307
- [ ] #6 The attention panel degrades to the narrow-terminal layout without hiding the top-ranked item
- [ ] #7 Component tests assert semantics (order, ranks, reasons, command text) rather than snapshots alone
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
