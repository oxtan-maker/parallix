---
id: TASK-2606
title: Show the recorded Mission title in the px active headline
status: backlog
assignee: []
created_date: '2026-09-28 13:46'
labels:
  - bug
  - cli
  - ux
dependencies: []
references:
  - src/adapters/cli/commands/active.ts
  - src/adapters/filesystem/mission-paths.ts
  - src/adapters/cli/commands/status-adapter.ts
priority: low
ordinal: 135008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px active` prints its headline as `Mission <slug>: <title>`. The title comes from `missionTitle()` in `src/adapters/filesystem/mission-paths.ts`, which reads the first line of `MISSION.md` in the Mission directory. Mission directories were retired (TASK-2521.07), so `findMissionDir` finds nothing and the headline now drops the title entirely.

Before the retirement, the same path printed the literal scaffold placeholder instead (`[INFO] Mission task-2553: <Title>`, reported in the removed TASK-2559), because `px draft` wrote `MISSION.md` from `templates/mission-scaffold.md` before the title was filled in.

Read the title from the same authority `px status` uses: the task card title first, then the recorded Mission title (see the `title` field in `src/adapters/cli/commands/status-adapter.ts`). Keep the existing trailing-id stripping so the headline never repeats the slug. Remove `missionTitle()` if it has no remaining production caller.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `px active <slug>` prints the Mission's real title for a Mission with no MISSION.md file
- [ ] #2 The headline never shows the `<Title>` scaffold placeholder or repeats the slug
- [ ] #3 The title comes from the same source `px status` reports, covered by a test
- [ ] #4 `missionTitle()` is removed if nothing else in production calls it
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
