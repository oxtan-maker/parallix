---
id: TASK-2560
title: Finish file-free runtime cutover for typed missions
status: done
assignee: [codex]
created_date: '2026-09-23 08:46'
updated_date: '2026-09-24 17:36'
labels:
  - ai_sdlc
  - bug
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
Typed missions record their contracts and checkpoint evidence in Mission state, but draft still generated MISSION.md and active could require it. Stop generating or committing MISSION.md and CP-N.md for typed missions; use recorded evidence for active and handoff. Preserve historical document compatibility where needed. Continue mirroring authoritative lifecycle updates into Backlog task files so users can follow their tasks there.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A new typed mission can be drafted and executed with no generated MISSION.md or CP-N.md in its target worktree.
- [ ] #2 Draft setup and commit safety do not create or commit placeholder mission documents; the typed Mission contract remains discoverable through px status.
- [ ] #3 Handoff and recovery validate recorded Mission/checkpoint evidence without consulting generated MISSION.md or CP-N.md for typed missions.
- [ ] #4 A regression test proves draft of a typed mission leaves no placeholder MISSION.md and succeeds through handoff.
- [ ] #5 Typed draft and handoff leave no generated mission documents while Backlog task status and assignment remain mirrored for users.
- [ ] #6 The workflow-path guard permits mission-directory preparation and Backlog mirroring but grants no normal-runtime exemption to write generated MISSION.md or CP-N.md files.
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
