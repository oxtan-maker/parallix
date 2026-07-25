---
id: TASK-2282
title: >-
  Ink TUI wave 1: runtime foundation, `px ui` read-only shell, and headless
  isolation gates
status: ready-for-integration
assignee: [custom]
created_date: '2026-07-19 00:00'
updated_date: '2026-07-24 04:22'
labels: [ai_sdlc]
dependencies:
  - TASK-2281
  - TASK-2302
references:
  - docs/adr/0044-workflow-distribution-model.md
  - docs/adr/0051-ui-neutral-application-boundary.md
  - /tmp/Parallix Kanban Board Controller.zip
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WAVE 1 of 7 (ADR 0036 multi-wave). This mission previously contained the ENTIRE Ink interface — layout, navigation, attention queue, guarded actions, progress, analytics, PTY smoke, and the default-invocation flip. That is a Large (235+ NEL) scope and MUST be split before activation (ADR 0036 §2). It is now wave 1 only; waves 2-7 are TASK-2304..TASK-2309 and each must reach `done` before the next leaves `refined`.

SCOPE OF THIS WAVE: make Ink exist in production at all, and prove it cannot leak into the headless path.

Today React/Ink exist only in the disposable TASK-2277 spike (`proofs/task-2277-local-runtime/package.json`); the production `package.json` has no React, no Ink, no JSX build, and no TSX lint/type config. Nothing in `src/interfaces` renders. TASK-2302 lands the concrete read adapters and wires `BoardProjectionBuilder` in the composition root, so a real `BoardProjection` is obtainable here — this wave consumes it read-only.

DELIVERABLE: `px ui` starts, obtains one `BoardProjection` from the composition root, renders a static (non-interactive) shell — repository identity, per-lane WIP counts, projection staleness/unavailable-source indication — and exits cleanly on `q`/Ctrl+C. No columns of cards, no navigation, no selection, no actions, no metrics. Those are waves 2-7 and adding them here re-creates the oversized mission.

NON-GOALS (explicit): keyboard navigation, mission detail, attention queue, command dispatch, progress rendering, analytics/CFD, PTY smoke coverage beyond launch+exit, and any change to no-command invocation. `px` with no command keeps its current behavior in every wave until TASK-2309.

Ink components contain no workflow, SQL, Git, Forgejo, or subprocess behavior; they read the projection and render. The import-boundary rule of ADR 0051 ("application/domain modules must not import Ink, React, ... except as port type definitions") gets its enforcing test here, before there is anything to violate it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 React and Ink are production dependencies with a JSX/TSX build, typecheck, and lint configuration; `./scripts/verify-local.sh all` and `static-analysis` pass on the changed tree
- [ ] #2 `px ui` renders repository identity, per-lane WIP counts, and explicit stale/unavailable-source indication from a single `BoardProjection` obtained via the composition root over the TASK-2302 concrete adapters
- [ ] #3 `px ui` exits cleanly on `q` and on Ctrl+C, restoring the terminal, with a non-zero exit only on real failure
- [ ] #4 Headless commands and non-TTY execution do not import or initialize Ink or React: a test asserts the module graph of the headless entry contains no react/ink module, and existing CLI output and exit codes are unchanged
- [ ] #5 An import-boundary test fails if any `src/application` or `src/domain` module imports React, Ink, or a terminal-rendering module other than as a type-only port definition
- [ ] #6 React/Ink imports are confined to the TUI and composition modules; a guardrail test names the allowed directories
- [ ] #7 The canonical ESM bundle still builds with Ink included, and the bundle-size gate records the new baseline rather than silently absorbing it
- [ ] #8 Component tests assert semantics (rendered values, not pixel snapshots) using a mocked projection port; no test launches an agent, contacts Forgejo, or runs a real workflow command
- [ ] #9 Rollback: removing the `px ui` entry and TUI directory leaves headless commands, bundle, and gates green — proven by test or documented revert evidence
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Promote React/Ink from the TASK-2277 proof into production dependencies; add JSX/TSX build, tsconfig, and lint configuration.
2. Add `src/interfaces/tui` with a static shell component reading a `BoardProjection`; wire `px ui` through the composition root.
3. Add the headless/non-TTY isolation test and the application/domain import-boundary guardrail.
4. Re-baseline the bundle gate; capture launch/exit evidence and the rollback proof.
<!-- SECTION:PLAN:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Static analysis and UI isolation pass
- [ ] #2 Tests mock application ports and execute no real workflow commands
- [ ] #3 Headless CLI compatibility remains green
- [ ] #4 Launch and clean-exit evidence for `px ui` is captured from a real terminal run (PTY coverage itself is wave 3 / TASK-2305)
<!-- DOD:END -->
