---
id: TASK-2305
title: >-
  Ink TUI wave 3: keyboard navigation, selection, mission detail, and PTY smoke
  harness
status: done
assignee: [codex]
created_date: '2026-07-24 04:23'
labels: [ai_sdlc]y
dependencies:
  - TASK-2304
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - src/application/projections/mission-detail.ts
  - /tmp/Parallix Kanban Board Controller.zip
priority: medium
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WAVE 3 of 7 (see TASK-2282). Wave 2 renders the lanes and cards read-only. This wave makes the board navigable, adds the mission detail view, and introduces the PTY test harness later waves reuse.

DELIVERABLE: a keyboard model (lane/card movement, wrap behavior, scrolling within a lane, focus indication), a selected-mission detail panel built from the existing `mission-detail` projection, and a real PTY smoke test covering launch, navigation, resize, and clean exit. Selection is view state only.

NON-GOALS: the attention queue (wave 4 / TASK-2306), executing anything (wave 5 / TASK-2307), analytics (wave 6 / TASK-2308). No key may trigger a workflow command in this wave; keys reserved for later actions render an explicit "not yet available" affordance.

The PTY harness introduced here is infrastructure for waves 4-7: deterministic, timeout-bounded, and it must not launch agents, contact Forgejo, or mutate the repository.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Keyboard navigation moves selection across lanes and cards with defined wrap/boundary behavior, scrolls within an overflowing lane, and shows focus unambiguously in both wide and narrow layouts
- [ ] #2 The selected mission renders a detail view from the shared mission-detail projection, with unavailable or stale sources shown as such
- [ ] #3 Selection is view state only: a test proves no navigation key issues a board command, workflow call, or filesystem/Git write
- [ ] #4 Keys reserved for future actions render an explicit unavailable affordance rather than silently doing nothing or executing
- [ ] #5 A PTY smoke test drives a real terminal session covering launch, navigation, resize, and clean exit with terminal state restored, bounded by an explicit timeout
- [ ] #6 The PTY harness is reusable by later waves and launches no agent, contacts no Forgejo, and makes no repository mutation
- [ ] #7 Component tests assert navigation semantics (selected id, visible window) rather than snapshots alone
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
