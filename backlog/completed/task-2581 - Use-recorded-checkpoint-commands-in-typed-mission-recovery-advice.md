---
id: TASK-2581
title: Use recorded checkpoint commands in typed mission recovery advice
status: done
assignee: []
created_date: '2026-09-26 06:55'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 112008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Typed mission recovery still tells implementers to create CP-N.md documents although checkpoint evidence is owned by Mission state and px checkpoint record. TASK-2521.06 exhausted handoff retries with missing CP evidence and contradictory document creation advice. The stale guidance is emitted by active.ts recovery advice and repair-handoff.ts. Update recovery advice to follow the recorded contract and named checkpoint commands. Slow px status is tracked separately; do not treat normal latency as an external dependency. Keep explicit historical import guidance without fabricating checkpoint evidence. But ensure px status shows all completed checkpoints.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Typed checkpoint recovery directs the implementer to reload the recorded contract and record named checkpoints with px checkpoint record and the current expected version.
- [ ] #2 Active and repair-handoff advice does not request new MISSION.md or CP-N.md templates for typed missions.
- [ ] #3 Regression tests cover emitted recovery instructions without invoking real agents or network services.
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
