---
id: TASK-2468
title: activate adhoc missions drafted from free text
status: backlog
assignee: []
created_date: '2026-09-07 16:54'
labels: [user_value, bug]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`px draft "fix hello world greeting"` creates a complete adhoc mission: branch `mission/adhoc-fix-hello-world-greeting`, dedicated worktree, scaffolded MISSION.md, and a synthetic Backlog task. That mission can then never advance: `px active adhoc-fix-hello-world-greeting` refuses with `slug must begin with task-` (`src/application/execute-mission-service.ts:145`), even though `isMissionSlug` in `src/adapters/filesystem/mission-paths.ts` accepts both `task-` and `adhoc-` slugs.

Effect: the zero-friction first-value path (new directory, one free-text draft, activate, integrate) dead-ends after drafting, and the operator must instead create a Backlog task first. This blocks the README first-value demo in task-2467 from showing the free-text path.

Expected: an adhoc mission drafted from free text can be activated, reviewed, and integrated exactly like a `task-` mission. `test/execute-mission-characterization.test.ts` asserts the current refusal and must be updated with the behavior change.
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
