---
id: TASK-2402
title: Stop px status for one mission from building the whole board
status: done
assignee: [codex]
created_date: '2026-08-23 07:25'
labels:
  - user_value
dependencies: []
ordinal: 112917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`px status <slug>` asks about one mission but currently builds the complete BoardProjection and then scans all generated cards to find the requested mission. This causes a single-mission command to pay for loading every mission, every review/gate fact, board metrics and unrelated projection work.

Give the status application path a targeted mission-status projection/query.

For an explicit slug:

`px status <slug>`

must load only the information required to return status for that mission and the genuinely global status fields the command already promises. It must not call the normal full `BoardProjectionBuilder.build()` / `loadAllMissions()` path merely to obtain one card.

Preserve the existing user-visible status contract: activity, lifecycle/backlog state, latest checkpoint information, review round/phase/disposition/history, approval owed and other currently returned mission-specific fields must remain correct.

Use existing domain/projection logic where practical so targeted status does not grow an independent set of rules for interpreting Mission state. It is acceptable to create a focused application query/read model. It is not acceptable to duplicate lifecycle/review semantics in CLI adapter code.

`px status` without an explicit slug may continue using broader repository-level reads where they are actually needed.

Do not turn this into a generic caching project. Do not optimize the general board builder here. Do not absorb TASK-2400 or TASK-2401. Consume their eventual abstractions if present after integration, but this mission must remain independently correct when developed in parallel.

Add behavioral and cost-shape tests. For an explicit mission, a test fixture containing many unrelated missions must prove those unrelated missions are not materialised/read merely to answer the selected mission. Do not assert only elapsed time; assert the read boundary itself.

Keep external status functionality that is genuinely global or mission-specific, such as branch/rebase/PR/agent information, unless inspection proves it is unrelated to the command contract.

<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
