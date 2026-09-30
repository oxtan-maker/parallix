---
id: TASK-2580
title: Activate persisted Mission when execute agent launches
status: done
assignee: []
created_date: '2026-09-26 06:13'
updated_date: '2026-09-26 06:14'
labels:
  - bug
dependencies: []
priority: high
ordinal: 111008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Running missions task-2577, task-2578 and task-2579 appear in the web refined lane despite active execution. Read-only inspection on 2026-09-26 confirmed all three worktree Backlog task files have status active, while the shared SQLite missions rows remain refined and operational_history reports running execute agents.

Root cause: commit 8750b7e20 (mission/task-2565, 2026-09-25) removed reconcileExternalMissionLifecycle from transitionTaskLocal. The execute onLaunch hook in src/adapters/cli/commands/active.ts still transitions only the Markdown task. ExecuteMissionService.launchAgent publishes current work but does not activate the persisted Mission. Its recordLaunch runs only after the awaited agent launch returns (after execution for attached agents), and for numbered task IDs it synchronizes only when rebaseDeferred is true or the Markdown status is not active. The launch hook already writes active, so normal completion can skip authoritative activation entirely. src/composition/board-projection.ts correctly takes lifecycle from SQLite, exposing the stale refined state.

Fix activation at the shared application boundary through the checked MissionLifecycleService. Within the first 200 ms after px active is invoked, either persist the active lifecycle transition or stop and report any immediate blocking error. Perform the bounded local validation needed for a legal transition promptly; do not wait for provider startup, agent output, or agent completion. Keep implementer assignment accurate as launch and fallback resolve the actual worker. Do not gate authoritative lifecycle on Markdown status or task-file presence. Keep current-work publication separate from lifecycle. Preserve fallback/resume and failed-launch behavior; do not restore the removed raw adapter-to-SQLite reconciliation. Include a safe repair path for already affected missions without restarting their agents or discarding evidence.

Responsiveness requirement: the web must reflect the persisted lifecycle change within 200 ms of px active invocation under normal local operation, including board refresh/stream delivery and rendering. An early current-work spinner alone does not satisfy this requirement. Measure command-to-visible-state latency and immediate rejection latency; include startup and projection delivery overhead.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A regression test holds the execute agent running after its launch callback and verifies the persisted Mission and projected web card are active before agent completion.
- [ ] #2 Activation uses the actual implementer on launch and fallback, and resumes and launch failures preserve valid lifecycle behavior.
- [ ] #3 Authoritative activation is not skipped because Markdown already says active or an optional task file is absent.
- [ ] #4 Already affected missions can be reconciled safely without restarting live agents or losing checkpoints and review evidence.
- [ ] #5 Within 200 ms of px active invocation under normal local operation, authoritative lifecycle becomes active or the command stops with its immediate blocking error; provider startup and agent execution do not delay this decision.
- [ ] #6 The web displays the resulting active lifecycle within the same 200 ms command-to-visible-state budget; verify the full path including command startup, persistence, projection delivery and rendering.
- [ ] #7 Immediate blockers prevent agent launch and leave lifecycle unchanged; add a runnable latency check for both activation and immediate rejection.
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
