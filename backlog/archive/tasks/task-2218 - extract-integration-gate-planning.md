---
id: TASK-2218
title: Extract integration gate planning from the integrate command
status: backlog
assignee: []
created_date: '2026-07-11 00:00'
labels:
  - refactor
  - maintainability
  - integration-gate
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`lib/commands/integrate.ts` is roughly 1,800 lines and combines preflight evaluation, integration-gate planning, merge orchestration, conflict recovery, stats, hooks, and cleanup. Extract the pure integration-gate planning seam into a focused module such as `lib/core/integration-gates.ts`.

The new module should own configuration loading, gate ordering, changed-area matching, and construction/printing of the gate plan. Leave gate execution and the integration transaction in `integrate.ts` unless the 250-500 line budget clearly permits a small adjacent helper.

Target change size: 250-500 total added plus deleted lines in the final diff, including tests and generated runtime artifacts. This mission must remain behavior preserving.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Extract `loadIntegrationConfig`, `orderIntegrationGates`, `gateMatchesChangedAreas`, and `getIntegrationGatePlan` with only the minimal supporting pure helpers into one focused module
- [ ] #2 Keep merge execution, Git mutation, worktree cleanup, post-integrate hooks, stats recording, and conflict recovery in `lib/commands/integrate.ts`
- [ ] #3 Preserve existing named exports from `lib/commands/integrate.ts` through re-exports or thin wrappers so downstream callers remain compatible
- [ ] #4 Preserve gate ordering, `run_last` behavior, changed-area matching, missing-config behavior, dry-run planning, and `--no-integration-gates` semantics
- [ ] #5 Add focused unit tests for the extracted planner, while retaining command-level tests that prove `integrate.ts` delegates without changing observable output
- [ ] #6 The final diff contains 250-500 added plus deleted lines as reported by `git diff --numstat` (excluding `graphify-out/`); if outside the range, document why in the final checkpoint and reduce scope where feasible
- [ ] #7 Run `./scripts/verify-local.sh static-analysis` and the focused integration/configuration tests successfully
<!-- AC:END -->

## Out of Scope

- Changing integration policy or gate configuration schema
- Executing gates concurrently
- Altering squash merge, stash, cleanup, or recovery behavior
- Adding new integration gates

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
