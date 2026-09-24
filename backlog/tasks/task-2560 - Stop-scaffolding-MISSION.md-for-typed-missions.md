---
id: TASK-2560
title: Stop scaffolding MISSION.md for typed missions
status: backlog
assignee: []
created_date: '2026-09-23 08:46'
labels:
  - ai_sdlc
  - bug
  - workflow
dependencies: []
references:
  - src/adapters/cli/commands/draft-setup.ts
  - prompts/execute-core.md
priority: high
ordinal: 97008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The TASK-2521.03 draft and execute prompts use px status and typed writes, but px draft still creates and commits templates/mission-scaffold.md as missions/<slug>/MISSION.md through ensureMissionFile in src/adapters/cli/commands/draft-setup.ts. TASK-2521.06 has a literal placeholder MISSION.md even though its complete contract is stored in Mission state (px status). Finish the file-protocol cleanup without weakening handoff trust; preserve explicit legacy import/export only. This is a TASK-2521.03 cleanup gap and should be coordinated with TASK-2521.05.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new typed mission can be drafted and executed with no generated MISSION.md or CP-N.md in its target worktree.
- [ ] #2 Draft setup and commit safety do not create or commit placeholder mission documents; the typed Mission contract remains discoverable through px status.
- [ ] #3 Handoff and recovery validate recorded Mission/checkpoint evidence without consulting generated MISSION.md or CP-N.md for typed missions.
- [ ] #4 A regression test proves draft of a typed mission leaves no placeholder MISSION.md and succeeds through handoff.
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
