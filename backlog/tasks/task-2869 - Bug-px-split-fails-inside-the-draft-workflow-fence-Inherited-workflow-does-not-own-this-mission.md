---
id: TASK-2869
title: >-
  Bug: px split fails inside the draft workflow fence (Inherited workflow does
  not own this mission)
status: backlog
assignee: []
created_date: '2026-11-21 15:11'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Drafting any Large mission cannot complete: the draft agent's `px split` always fails with `[FAIL] Inherited workflow does not own this mission`, the mission stays "Large-mission readiness: BLOCKED", and the draft step is retried until attempts run out.

Root cause: two independently delivered missions never composed. The inherited workflow write fence (task-2750, d22332f96) authorizes writes only for the one mission the workflow operation owns (`operation.missionId === mission` in `src/composition/workflow-authorization.ts`) and is checked per aggregate in `SqliteMissionStore.persistAggregate`. The Mission-wave split (px-0030, 792763792) persists the parent plus new child missions `<parent>.NN` in one `saveWave` transaction, and `persistAggregate` fenced each child under its own id, which the draft operation never owns. No test ran a wave split under a fence, and the fence test asserts only that unrelated missions are refused.

Observed: TASK-2866 (2026-11-20, tmux host) and TASK-2867 (2026-11-21, pipe host) draft runs all failed the same way; both waves were created only by running `px split` from an operator shell without PARALLIX_WORKFLOW_OPERATION/GENERATION. The agents correctly refused to bypass the guard.

Fix direction (kept minimal, preserves both features): wave children are authorized through their owned parent (`persistAggregate(child, null, parent.id)` in `saveWaveAggregate`), so the fence is not widened for any other writer. Reproduction retained in the owning suite test/integration/sqlite/mission-aggregate-write-isolation.test.ts.

Systemic follow-up: any new multi-mission writer (wave split, any future child/derived-mission creation) must be exercised under an inherited fence, not only under an unfenced store.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A fenced draft workflow completes px split for a Large mission and the children exist with the recorded dependencies
- [ ] #2 The fence still refuses writes to any mission other than the owned parent and its wave children
- [ ] #3 The reproduction is red on the parent behavior and green with the fix, in the existing write-isolation suite
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
