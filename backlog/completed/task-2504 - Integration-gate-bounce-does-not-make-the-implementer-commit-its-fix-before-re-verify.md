---
id: TASK-2504
title: Integration-gate bounce does not make the implementer commit its fix before re-verify
status: done
assignee: [claude]
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
2. The bounce itself does not capture a repair the implementer leaves
   uncommitted before re-running the gate. A correct repair can therefore never
   reach the re-verify step when the agent forgets the commit.

The integration bounce must provide the same recovery guarantee as an execute
agent's commit-safety harness, but it must not become a blanket "commit a dirty
worktree" command. Its pre-launch tree is already required to be clean by the
integration gate. Treat a post-launch dirty diff as repair-agent-owned only
under that dedicated-worktree contract, and make the fallback visible in the
operator output.

The `hook-failure` remedy already says "so the Git hook passes when Parallix
commits or rebases this mission"; the `gate-failure` remedy omits the commit
step entirely, which is why gate bounces dead-end here.

Scope (propose the smallest correct choice; do not build both):
- Make the `gate-failure` remedy in `promptSlotsFor` require the implementer to
  commit the repair before the re-verify, and state that an uncommitted fix
  cannot be verified.
- Add a repair-agent commit-safety step immediately after a successful
  `gate-failure` implementer exit and before the re-verify. If the repair tree
  is dirty, stage and commit its changes with a deterministic message that
  identifies this as an integration-gate repair fallback, then run the existing
  clean-tree guard and the identical configured gates.
- Preserve the ownership boundary: capture the pre-launch `HEAD` and require a
  clean pre-launch tree; do not auto-commit unresolved conflicts, a dirty
  baseline, or a tree whose `HEAD` changed while the agent ran. Those cases may
  include a user's or another process's work and must remain dirty with a clear
  diagnostic. A clean tree after an agent-authored commit is a no-op.
- If staging or committing fails (including a hook failure), leave the repair
  intact, report the exact failure, and do not re-run the gate. Never bypass a
  hook, reset, stash, or discard files to make verification run.
- Log every fallback commit and its paths. The normal fix prompt must still say
  that the implementer should commit; the fallback is recovery for omission,
  not the primary workflow.
- Keep the bound: the dirty-tree guard in `routeIntegrationGateFailure`'s
  `verify` is correct and must stay. This task is about telling the
  implementer about it and closing the gap, not removing the guard.
<!-- SECTION:DESCRIPTION:END -->

## Reproduction

1. Introduce a failing integration test and let the bounced implementer fix it
   in the dedicated mission worktree without committing.
2. Run `npm run test:integration` from the mission worktree.
3. The bounce relaunches the implementer, records the clean pre-launch
   baseline, creates the repair fallback commit, and re-runs the identical gate
   green.
4. Separately prove that a dirty baseline, conflicted tree, or changed `HEAD`
   is never auto-committed and prevents the re-verify with an actionable
   diagnostic.

Red-to-green reproduction test: a focused test around
`routeIntegrationGateFailure` (or its repair-commit seam) that leaves the
mission tree dirty after a successful implementer fix and proves the fallback
commit precedes re-verification. Include rejection tests for every ownership
guard above and for a rejected fallback commit.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
- [ ] #7 A successful uncommitted integration-gate repair is committed exactly once before re-verification; a clean agent-authored commit remains a no-op
- [ ] #8 Dirty baseline, conflicts, changed HEAD, staging failure, and commit-hook failure never auto-commit or run the gate
<!-- DOD:END -->
