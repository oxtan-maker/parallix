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
## What broke it (history, so the fix targets the cause)

- `2026-06-24` task-1341 shipped free-text drafting (`adhoc-` slugs, synthetic Backlog task) in `lib/commands/draft.js`. `px active` at that time had no slug-prefix check, so an adhoc mission could be activated: the minimal-friction path worked.
- `2026-07-20` task-2276 added the stubbed-agent lifecycle e2e (`test/e2e-mission-lifecycle.test.ts`), but only for `task-` slugs — its fixtures use `task-2001`/`task-2002` and even the stub agent parses its slug with `/^Slug:\s*(task-[a-z0-9-]+)/im`. The free-text path was never covered.
- `2026-07-21` task-2289 introduced `LegacyActiveAdapter.validateSlug` with `if (!slug.startsWith('task-'))` while moving activation behind a port. That is the commit that broke it; nothing failed, because no test exercised an adhoc activation.
- `2026-08-03` task-2332.04 carried the same line into `src/application/execute-mission-service.ts` and added a characterization test asserting the refusal, cementing the regression as intended behavior.

So: the guard was never a decision about adhoc missions, it was an assumption copied into a new layer during a refactor and then locked in by a characterization test. Fix the assumption, do not add a compatibility shim around it — and widen the stub's slug regex, or the new e2e will silently fall back to `task-unknown`.

Related: task-1358 asked for exactly this stubbed lifecycle net in `2026-06-26` and was archived `2026-07-02` still in `backlog` status, three weeks before the break.
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
