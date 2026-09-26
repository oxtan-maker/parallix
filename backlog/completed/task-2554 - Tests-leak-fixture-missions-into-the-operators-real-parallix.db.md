---
id: TASK-2554
title: Tests leak fixture missions into the operator's real parallix.db
status: done
assignee: [custom]
created_date: '2026-09-22 10:37'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 92008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bug

The operator database `~/.local/state/parallix/parallix.db` held 19 missions under 18 throwaway repository IDs created by test fixtures, e.g. `handoff-fallback-umHnJC`, `px-board-test-QjzERN`, `parallix-pty-ui-fixture-HiHkpE`, `workflow-stats-fixture-sFXiau`, `nel-capture-bucket-aimXQW`, `parallix-first-value-t82xoq`, `px-integ-gate-Iic2GT`. `board_lane_events` and `session_markers` held rows for some of these repositories too. Found 2026-09-22 while listing open missions for TASK-2521.03.

Fixture prefixes point at these files (the IDs are the tmp-dir names they create):
- `test/handoff.test.ts` (handoff-fallback, handoff-relaunch-success, nel-capture-*)
- `test/adapters/board-projection-builder-cp3.test.ts` (px-board-test)
- `test/stats.test.ts` (workflow-stats-fixture)
- `test/tui-pty-smoke.test.ts` (parallix-pty-ui-fixture)
- `test/tui-spawn.test.ts` (parallix-tui-spawn)
- `test/task-1039-integrate.test.ts` (px-integ-gate)
- unknown sources: `task-1209-consume-*`, `parallix-first-value-*`, `main-task-*`, `adhoc-create-a-hello-world-program`, `repo`

It has not been checked whether these tests still leak today or whether the rows are from older runs. The first step is to check that.

TASK-2521.06 found a concrete collision: fixture repository `handoff-relaunch-success-2bYtvu` owns global Mission ID `task-1388` in the operator DB, while the Parallix repository has a retained TASK-1388 task file. The migration correctly refuses to attach the real task body to the fixture Mission, leaving one required task record missing. Include this row in the backed-up fixture cleanup, then rerun the migration audit.

The single `task-1388` fixture row was removed on 2026-09-24 after an integrity-checked backup. TASK-2521.06 then imported the real TASK-1388 and its three checkpoints; the audit reports zero missing task records. The general test-isolation fix and cleanup of other leaked fixtures remain open.

## Fix direction

A test process must never resolve the operator's default `PARALLIX_HOME`. Isolation should be the runner's default (for example, the test entry point sets a per-run temporary `PARALLIX_HOME` before any test loads), not something each test has to remember. A guard should fail the run if the default operator DB gained rows during it. `test/e2e-real-agent-smoke.test.ts` already has a delta-based check of this kind.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 It is established, with evidence, which tests (if any) still write to the default operator PARALLIX_HOME
- [ ] #2 Every test process (unit, integration, e2e) resolves an isolated PARALLIX_HOME by default without per-test setup
- [ ] #3 A guard fails the test run if the default operator database gained mission, lane-event, or session-marker rows during the run
- [ ] #4 The remaining leaked fixture rows are removed from the operator DB by an explicit, backed-up cleanup
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
