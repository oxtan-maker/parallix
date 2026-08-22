---
id: TASK-2387
title: Make board-launched agents publish current work
status: done
assignee: [codex]
created_date: '2026-08-21 11:03'
labels:
  - bug
  - user_value
dependencies: []
references:
  - src/application/controller/board-controller.ts
  - src/composition/application-services.ts
  - src/composition/board-projection.ts
  - src/composition/production-capabilities.ts
priority: high
ordinal: 104917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The TUI board constructs a second ExecuteMissionService from ExecuteMissionPorts without the production CurrentWorkPort. That service silently defaults to NO_CURRENT_WORK_PORT. Agents started through active:execute can run, but the board never records their running, ended, or blocked state; because the host process is px ui, the legacy process scan does not recover the missing fact. Wire board dispatch to the same current-work publisher as CLI execution and prove the complete board launch lifecycle through the real controller boundary.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 BoardCommandController dispatch of active:execute publishes running state through the production CurrentWorkPort before or at agent launch.
- [ ] #2 Successful, blocked, failed, and cancelled board executions publish the same terminal current-work outcomes as CLI execution.
- [ ] #3 Production TUI composition cannot construct an active dispatcher that silently uses NO_CURRENT_WORK_PORT while operator state is available.
- [ ] #4 A red-to-green controller/composition test proves a board-launched agent appears in the WORKING projection and later clears or blocks correctly.
- [ ] #5 ./scripts/verify-local.sh static-analysis passes.
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
