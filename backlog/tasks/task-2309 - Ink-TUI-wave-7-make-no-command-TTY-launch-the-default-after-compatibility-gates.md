---
id: TASK-2309
title: >-
  Ink TUI wave 7: make no-command TTY launch the default after compatibility
  gates
status: backlog
assignee: []
created_date: '2026-07-24 04:24'
labels:
  - ink
  - tui
  - ui
  - cli
dependencies:
  - TASK-2308
references:
  - docs/adr/0051-ui-neutral-application-boundary.md
  - docs/adr/0044-workflow-distribution-model.md
priority: low
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WAVE 7 of 7 (see TASK-2282), Quick Flow. ADR 0051 and the original TASK-2282 scope state: "`px ui` is explicit first; no-command TTY launch becomes default only after non-TTY and compatibility gates pass." This is a single, reversible invocation-policy flip and is isolated so it cannot ride along with feature work.

DELIVERABLE: `px` with no command and an interactive TTY launches the board; `px` with no command and no TTY keeps its exact current output and exit code; an opt-out (env var or config) restores the previous no-command behavior. `px ui` continues to work explicitly.

PRECONDITION: waves 1-6 are `done` and their gates green. If any compatibility or isolation gate is red, this flip does not happen — the fallback is that `px ui` stays explicit indefinitely, which is a fully acceptable end state.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `px` with no command in an interactive TTY launches the board; `px ui` still works explicitly
- [ ] #2 `px` with no command without a TTY (pipe, CI, redirected stdout) produces byte-identical output and the same exit code as before this change, proven by test
- [ ] #3 A documented opt-out restores the previous no-command behavior in a TTY, and is covered by test
- [ ] #4 Ink is still not imported or initialized on any non-TTY path
- [ ] #5 The change is a single reversible commit: reverting restores explicit-only `px ui` with all gates green
- [ ] #6 Help text and docs describe the new default and the opt-out
- [ ] #7 `./scripts/verify-local.sh all` passes plus `static-analysis` for the changed `src/` code
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
