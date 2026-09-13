---
id: TASK-2504
title: Integration-gate bounce does not make the implementer commit its fix before re-verify
status: backlog
assignee: []
created_date: '2026-09-13 16:50'
labels:
  - bug
  - ai_sdlc
dependencies: []
references:
  - src/application/rebound-kernel.ts
  - src/adapters/cli/commands/integrate-gate-rebound.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An integration-gate bounce relaunches the implementer with a fix prompt, but
the prompt never tells the implementer to **commit** its fix, and the bounce
does not autocommit the repair before re-running the gate. The re-verify step
then fails on a clean-tree requirement the implementer was never told about, so
a correct one-line fix is reported as "still failing" and the mission aborts.

Observed on task-2497: the failing test `verifyReview handles gate failures`
was fixed by pointing `cwdFn` at the temp dir instead of a hardcoded path, but
the fix was left in the working tree uncommitted. The bounce's `verify` then
returned:

    The repair is not committed, so the integration gates cannot re-run:
    selected execution root is not finalized (dirty tree): /mnt/data/code/parallix-task-2497

The fix was correct; the bounce could not observe it because it was not
committed. The implementer was not prompted to commit, so it had no reason to.

Two coupled gaps:

1. The single fix-prompt builder (`buildReboundFixPrompt`,
   `src/application/rebound-kernel.ts`) states only "The failing check re-runs
   automatically after your fix" — it never says commit the repair first. For
   the `gate-failure` slot this is a real defect: the verify step needs a
   finalized tree, so "after your fix" must mean "after you commit your fix."
2. The bounce itself does not autocommit the repair before re-running the gate,
   so even an implementer that does commit is not protected if it forgets, and
   an implementer that does not commit cannot pass regardless of prompt wording.

The `hook-failure` remedy already says "so the Git hook passes when Parallix
commits or rebases this mission"; the `gate-failure` remedy omits the commit
step entirely, which is why gate bounces dead-end here.

Scope (propose the smallest correct choice; do not build both):
- Make the `gate-failure` remedy in `promptSlotsFor` require the implementer to
  commit the repair before the re-verify, and state that an uncommitted fix
  cannot be verified.
- Consider whether the bounce should autocommit a clean repair before
  re-running the gate (guarding against the dirty-tree verify failure), or
  whether a clear prompt is sufficient. A commit the implementer did not make
  should never be autocommitted; only a repair the implementer itself made.
- Keep the bound: the dirty-tree guard in `routeIntegrationGateFailure`'s
  `verify` is correct and must stay. This task is about telling the
  implementer about it and closing the gap, not removing the guard.
<!-- SECTION:DESCRIPTION:END -->

## Reproduction

1. Introduce a failing integration test and fix it in the working tree **without
   committing** (or fix it in a way the implementer leaves uncommitted).
2. Run `npm run test:integration` from the mission worktree.
3. The bounce relaunches the implementer, re-verify runs, and returns
   `The repair is not committed, so the integration gates cannot re-run: ...
   dirty tree` even though the fix is correct — because nothing told the
   implementer to commit.

Red-to-green reproduction test: a unit test for `routeIntegrationGateFailure`
(or its `verify` seam) that leaves the mission tree dirty after the implementer
"fix" and asserts the current diagnostic names the uncommitted repair, then
asserts the fixed behaviour (prompt tells the implementer to commit, and/or the
bounce reports the repair correctly once committed).

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
