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
## Guards (the point of this task)

The minimal-friction path rotted once without anyone noticing. Fixing the guard is the small part; keeping it fixed is the task.

- Replace the `task-` check in `execute-mission-service.ts` with the existing shared validator (`isMissionSlug` in `src/adapters/filesystem/mission-paths.ts`). Do not add a second slug classifier beside it — one validator, edited in place.
- Extend the stubbed-agent lifecycle e2e (`test/e2e-mission-lifecycle.test.ts`, which already runs draft -> active -> review -> integrate against stub `codex`/`opencode` binaries on a fixture PATH) with the free-text case: a fresh repo with no Backlog task, `px draft "<free text>"`, then activate, review, and integrate the resulting `adhoc-` mission. This runs without a real model, so it belongs in the default suite and is the regression net for the README first-value path.
- Every other command in that first-value path (`px status`, `px review`, `px integrate`) must be asserted to accept an `adhoc-` slug in the same run, so a future guard added elsewhere fails the suite instead of the user.
- Update `test/execute-mission-characterization.test.ts`, which currently asserts the refusal.
- Assertions cite files and symbols or test names, never `file.ts:<line>` from another file.
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
