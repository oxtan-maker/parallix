---
id: TASK-2560
title: Finish file-free runtime cutover for typed missions
status: backlog
assignee: []
created_date: '2026-09-23 08:46'
updated_date: '2026-09-24 17:36'
labels:
  - ai_sdlc
  - bug
  - workflow
dependencies: []
references:
  - src/adapters/cli/commands/draft-setup.ts
  - src/application/handoff-command-use-case.ts
  - src/adapters/backlog/task-transitions.ts
  - test/fixtures/durable-state-inventory.ts
priority: high
ordinal: 97008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-2521.03 moved agents to px status and typed writes, but runtime code still scaffolds/commits MISSION.md, writes Backlog task files, and retains handoff CP-1.md compatibility generation and file reads. TASK-2521.06 cannot truthfully report zero normal-runtime readers/writers while these paths remain. Remove or isolate them behind explicit one-shot legacy import/export, using recorded Mission state for normal operations. Preserve fail-closed semantic evidence checks. The old TASK-2521.05 was retired after TASK-2521.03 absorbed this scope.

TASK-2521.06 also found 111 completed-mission CP files whose Goal Check or action differs from checkpoint data already in Mission state before the migration began. Thirty-five stored versions match a Git revision on some ref; 76 match no committed revision examined. The old handoff path records parsed CP text into SQLite while CP files can later change. Trace this divergence in the cutover and make typed checkpoint evidence the single current authority; keep historical file content discoverable for migration audit.

The current `task-2550` Mission is in review with no recorded brief, success criteria, or checkpoint plan. Its worktree's MISSION.md is still the literal `<Goal>` template, so the missing contract cannot be recovered from that file. Repair this pre-cutover mission from an operator-approved contract or an actual source-backed handoff record before treating the migration audit's required-context counter as zero; do not infer criteria from the template or task description.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new typed mission can be drafted and executed with no generated MISSION.md or CP-N.md in its target worktree.
- [ ] #2 Draft setup and commit safety do not create or commit placeholder mission documents; the typed Mission contract remains discoverable through px status.
- [ ] #3 Handoff and recovery validate recorded Mission/checkpoint evidence without consulting generated MISSION.md or CP-N.md for typed missions.
- [ ] #4 A regression test proves draft of a typed mission leaves no placeholder MISSION.md and succeeds through handoff.
- [ ] #5 Normal draft, assignment, handoff, review, integration, and closeout create no MISSION.md, CP-N.md, review-event, or Backlog task metadata file and do not read retired files for current state.
- [ ] #6 The retired workflow-path guard inventory no longer grants normal-runtime exemptions for those file reads and writes; explicit historical import/export remains isolated.
- [ ] #7 The pre-cutover `task-2550` review Mission has an operator-approved typed contract and evidence plan, or is explicitly stopped; no placeholder document is treated as a contract.
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
