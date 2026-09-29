---
id: TASK-2611
title: >-
  Reconcile backlog/tasks against landed Missions now that self-hosted closeout
  deletes task files
status: backlog
assignee: []
created_date: '2026-09-29 07:02'
labels:
  - bug
  - workflow
  - integration
dependencies: []
references:
  - src/application/integrate/squash.ts
  - src/adapters/backlog/task-transitions.ts
  - src/adapters/backlog/task-file-io.ts
  - workflow.config.json
  - docs/adr/0053-operational-persistence-and-authority-boundaries.md
  - docs/config.md
priority: high
ordinal: 139008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Symptom

Over the last 24-78 hours, `backlog/tasks/` has held tasks whose work is already on `main`, and closed tasks leave no trace in the Backlog tree. The operator had to find and delete stale task files by hand (TASK-2521.07, TASK-2547.01 and TASK-2559 were removed inside the squash `4f8a6e18a`). TASK-2571 ("px status shows all completed checkpoints") is still open, but TASK-2593 landed the same behaviour in `7ff9d021f`: `px status <slug>` now lists every recorded checkpoint.

## Root cause

Archiving was not lost by accident. TASK-2521.07 (landed in `ec9ad2eea`, 2026-09-27) removed it on purpose. That task was written as part of the TASK-2521 file-free wave, and it told the agent to remove Parallix's own `backlog/tasks/**`, `backlog/completed/**` and `backlog/archive/**` on the premise that the Mission aggregate is the only lifecycle authority (ADR 0053). The mission did three things:

1. It deleted 587 Backlog files, including open tasks. The operator restored the open ones in `a88ec1746` ("restored overdeletion"). That restore also brought back TASK-2521.07 itself, which had landed 25 minutes earlier, plus TASK-2547.01 and TASK-2559.
2. It set `adapters.tasks.selfHostedCloseout: true` in `workflow.config.json`. `stageCloseout` in `src/application/integrate/squash.ts` then calls `completeTask(slug, root, { retainLegacyRecord: false })`, and that call runs `fs.rmSync` on the task file (`src/adapters/backlog/task-transitions.ts`). Every landing since then (TASK-2581 onward) deletes the task file instead of moving it to `backlog/completed/`.
3. It left the stale-copy guards in place, but they are now blind. `checkBacklogIntegrity` in `src/adapters/backlog/task-file-io.ts` only reports `duplicate-completed` when a canonical copy exists in `backlog/completed/` or `backlog/archive/`. Both directories are gone, so `dropStaleBacklogCopies` and the fail-closed "Stale backlog copies remain after closeout" backstop in `squash.ts` (TASK-2534) can never fire. A task file for landed work can come back without anything noticing: through a manual restore, through a squash that carries another mission's pre-squash task file, or through a re-created duplicate.

Result: the only record that a task is closed is now the Mission row in SQLite (`closedAt`) and the `Task: <slug>` trailer on the landed squash. No Backlog-side check consults either, so "task file present" no longer means "work not landed".

## Related symptom (same wave, separate defect)

Missions drafted from tasks that have a folded YAML title (`title: >-`) record the literal title `>-`. Two landed commits carry the subject `>-`: `e74afe6a5` (TASK-2598) and `fb8bbd07f` (TASK-2594). One source is the regex `/^title:\s*(.+)$/` in `src/adapters/cli/commands/draft-stats.ts`. The legacy importer in `legacy-mission-import.ts` already treats `>-` as a placeholder title. Fix the title source here or in a linked task, and use a real YAML parse.

## Systematic fix

Base the closed-task guards on the authority that actually records closure, not on directories that no longer exist:

- Give the task adapter a way to ask whether a task slug is closed. The Mission aggregate answers it: the Mission has `closedAt` set, or `main` contains a landed squash whose body has the `Task: <slug>` trailer (use `isLandedSquashMessage`). Replace the `completed/`/`archive/` canonical check in `checkBacklogIntegrity`, `dropStaleBacklogCopies` and the post-closeout backstop in place. Do not add a parallel guard. Keep the directory check only where `selfHostedCloseout` is false.
- During integration, fail closed (the TASK-2534 behaviour) when the staged payload adds or keeps a `backlog/tasks/` file for a closed task.
- Report stale task files: `px status` (overview) lists every `backlog/tasks/` file whose task is already closed, with the landing commit and the `git rm` repair.
- Decide and document the operator-visible history of closed tasks now that `backlog/completed/` is gone. Either keep a completed mirror as the explicit self-hosted choice, or document that `px`/Mission history is the only closed-task view and that Backlog.md tools will not show done tasks. Update `docs/config.md` under `selfHostedCloseout` and the owning ADR in place.
- Clean up the current tree once, using the new detection. Remove TASK-2571 if its behaviour is confirmed covered by TASK-2593.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With selfHostedCloseout enabled, a backlog/tasks/ file whose Mission is closed or whose Task: <slug> squash is on main is detected, without any backlog/completed/ or backlog/archive/ directory
- [ ] #2 px integrate refuses to land a squash that adds or keeps a backlog/tasks/ copy of a closed task, and names the file and the git rm repair
- [ ] #3 px status overview lists stale task files for already-landed work, with the landing commit
- [ ] #4 The completed/archive-based duplicate check is replaced in place for self-hosted closeout; repositories with selfHostedCloseout false keep today's completed-mirror behaviour
- [ ] #5 Red-to-green repro: restoring a landed task file (the a88ec1746 shape) and resurrecting one through a mission branch's pre-squash history are both caught
- [ ] #6 docs/config.md and the owning ADR state where closed-task history lives under self-hosted closeout
- [ ] #7 The current backlog/tasks/ tree holds no task whose work is already on main
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
