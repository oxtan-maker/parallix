---
id: TASK-2619
title: Restore review start and recovery for file-free Missions
status: backlog
assignee: []
created_date: '2026-09-30 07:13'
labels:
  - bug
dependencies: []
priority: high
ordinal: 146008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2614 is a native database-backed Mission: active, all checkpoints recorded, Review null, open Forgejo PR #528, clean rebased HEAD 48a3fe91e. review --continue rejects the absent Review and points to --reconcile-review. review --start --dry-run also rejects it because ReviewWorkflowAdapter uses existence of the retired missions/<slug> directory as knownMission. --reconcile-review then requires a Backlog task file already marked review, ignoring authoritative Mission status. This traps completed native missions between active and review. Audit the start/handoff and reconciliation path for retired mission/task file checks; use the Mission aggregate as authority, preserve version checks and reviewer separation, and provide a supported recovery command without recreating legacy files.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A known active database-backed Mission with completed checkpoints and no legacy mission directory can start review and persist a valid Review before reviewer launch.
- [ ] #2 Recovery for an interrupted handoff uses authoritative Mission state and works without a legacy task file marked review; diagnostics give an executable continuation path.
- [ ] #3 Regression coverage reproduces TASK-2614 with Review null and an existing Forgejo PR; review can resume while unknown missions, invalid transitions, and self approval remain rejected.
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
