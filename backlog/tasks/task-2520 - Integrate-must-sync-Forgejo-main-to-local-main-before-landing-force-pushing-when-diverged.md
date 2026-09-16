---
id: TASK-2520
title: >-
  Integrate must sync Forgejo main to local main before landing, force-pushing
  when diverged
status: backlog
assignee: []
created_date: '2026-09-16 08:08'
labels:
  - integrate
  - forgejo
dependencies: []
references:
  - src/adapters/forgejo/forgejo-git.ts
  - src/application/integrate/landing.ts
  - src/application/integrate/rebase.ts
priority: high
ordinal: 82007
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem
On 2026-09-16, `px integrate task-2512` passed all 5 integration gates. It then failed in sync-merged with `push-primary-failed`: the push of landed commit f787eee8d to Forgejo `main` was rejected as non-fast-forward.

Root cause: local `main` was rewritten on 2026-09-15 at 19:54. It was reset to 2d8a37fa3, and missions 2515–2510 were squashed into 5ac4f6eeb. The tree was identical to Forgejo's c01102add, but Forgejo `main` was never updated after the rewrite. Local `main` is the source of truth, but nothing in integrate enforces that Forgejo matches it. The previous rewrite on 2026-09-14 only worked because Forgejo `main` was force-pushed by hand.

Relevant code:
- `src/adapters/forgejo/forgejo-git.ts` (`syncMerged`, around line 380): pushes the landed commit to `refs/heads/<primary>` without force and fails when the push is not a fast-forward.
- `src/application/integrate/landing.ts` / `rebase.ts`: the mission rebase onto local base happens, but Forgejo base is never reconciled.

## Desired behaviour
Local `main` (the recorded base branch) is authoritative. Forgejo is a mirror for review.
1. Before squash/landing, the mission must be rebased onto the current local base branch. Verify this still holds after the step split in TASK-2512.
2. Before sync-merged, and regardless of what happened on local main or on the mission branch, make sure Forgejo `<base>` equals local `<base>`:
   - If Forgejo `<base>` is an ancestor of local `<base>`, do a plain push.
   - Otherwise (diverged or rewritten), force-push with `--force-with-lease=<base>:<fetched review sha>` and log clearly what was overwritten (old sha → new sha).
3. The landed commit push in sync-merged must then always be a fast-forward. If it is still rejected, fail with a clear diagnostic.

## Safety
- Use force-with-lease against the freshly fetched sha, never a blind `--force`.
- Warn when Forgejo `<base>` contains commits whose content (tree) is not present in local `<base>`, so that content is not silently lost. Decide whether this warns or aborts. Suggested: abort unless an explicit flag is given.
## Related rebase bugs found during the same recovery (2026-09-16)
These bugs predate TASK-2512. The old `integrate.ts` had the same order and the same messages.
4. **Retrying after a failed sync-merged dead-ends.** `runIntegrationRebase` (`src/application/integrate/rebase.ts`) always runs before the probe merge. `findExistingSquashCommit` / `resumeLandedSquash` (`src/application/integrate/landing.ts`) is only reached afterwards. When local `<base>` already contains the mission's squash commit, rebasing the full mission history onto it conflicts: task-2512 paused with 24 of 39 commits left. The retry never reaches the resume path. Expected: detect the existing squash on `<base>` before rebasing, and go straight to finishLanding / sync-merged.
5. **`px rebase` reports success on a paused rebase.** The shared rebase workflow printed `[PASS] Rebase completed cleanly.` after "More conflicts found. Re-running classification...", while the mission worktree was still mid-rebase ("interactive rebase in progress", 24 commands remaining). It must not report success while `rebase-merge/` exists in the mission worktree.
6. **`runIntegrationRebase` checks the wrong worktree for an in-progress rebase.** It runs `git -C <baseWorktree> rebase --show-current`, but the rebase runs in the mission worktree, so `inProgress` is always false. The failure was only caught by the ancestry check (`Integration-time rebase did not complete cleanly (inProgress=false, ...)`), and the mission worktree was left mid-rebase without an abort. Expected: check the mission worktree's rebase state, and abort or report it with recovery instructions.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Integrate reconciles Forgejo <base> to local <base> before sync-merged; a rewritten local main no longer causes push-primary-failed
- [ ] #2 Reconciliation uses --force-with-lease pinned to the fetched Forgejo sha and logs old -> new sha
- [ ] #3 Integrate aborts (or requires an explicit flag) when Forgejo <base> holds content absent from local <base>
- [ ] #4 Mission branch is verified rebased onto current local <base> before squash
- [ ] #5 Regression test: diverged-but-content-equivalent Forgejo main (the 2026-09-15 scenario) integrates successfully
- [ ] #6 Re-running integrate after a failed sync-merged (squash already on local <base>) skips the rebase and resumes closeout
- [ ] #7 px rebase never reports "Rebase completed cleanly" while the mission worktree still has a rebase in progress
- [ ] #8 Integration-time rebase detects an in-progress rebase in the mission worktree (not the base worktree) and leaves no half-finished rebase behind
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
