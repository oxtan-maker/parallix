---
id: TASK-2282
title: Implement Ink TUI over shared application contracts
status: backlog
assignee: []
created_date: '2026-07-19 00:00'
labels:
  - ink
  - tui
  - react
  - ui
dependencies:
  - TASK-2281
  - TASK-2302
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - https://claude.ai/code/artifact/5f739bc8-6e14-48c7-aca6-ed9a96923432
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the interactive Ink interface over the shared board projection, command controller, and progress events. Preserve the design intent of attention-first operation, workflow stages, agent state, guarded actions, and command feedback while adapting layout and interaction to terminal constraints.

Ink components contain no workflow, SQL, Git, Forgejo, or subprocess behavior. `px ui` is explicit first; no-command TTY launch becomes default only after non-TTY and compatibility gates pass.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 `px ui` renders repository identity, attention items, workflow stages, agent availability, selected mission detail, available actions, and operation progress from shared projections
- [ ] #2 Keyboard navigation, selection, action confirmation, cancellation, resize, narrow-terminal fallback, and clean shutdown have semantic tests
- [ ] #3 Destructive or consequential actions show the exact application command and require confirmation; stale capability results refresh rather than executing blindly
- [ ] #4 Headless commands and non-TTY no-command execution do not import or initialize Ink and retain existing output and exit codes
- [ ] #5 Component tests assert semantics rather than relying only on snapshots
- [ ] #6 PTY smoke tests cover launch, navigation, one harmless read, cancellation, resize, and exit
- [ ] #7 React/Ink imports remain confined to TUI and composition modules
- [ ] #8 Source, bundle, UI-isolation, static-analysis, and compatibility gates pass
- [ ] #9 Rollback removes the TUI entry without affecting headless commands
<!-- AC:END -->

## Implementation Plan

1. Build view models from the shared board projection.
2. Add terminal layout, navigation, details, and attention views.
3. Add guarded actions and progress rendering.
4. Prove TTY/non-TTY isolation and PTY behavior before changing default invocation.

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] #1 Semantic component and PTY evidence is captured
- [ ] #2 Static analysis and UI isolation pass
- [ ] #3 Tests mock application ports and execute no real workflow commands
- [ ] #4 Headless CLI compatibility remains green
<!-- DOD:END -->
