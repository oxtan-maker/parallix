---
id: TASK-1317
title: Forgejo PR creation fails on first push when branch has no remote tracking ref
status: done
assignee: [qwen]
created_date: '2026-06-15 21:05'
updated_date: '2026-06-16 04:32'
labels:
  - user_value
dependencies: []
references:
  - lib/tools/forgejo.js
priority: high
ordinal: 625
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The automated post-execute handoff (`createPr` -> `buildCreatePrPushArgs` in `lib/tools/forgejo.js`) aborts when creating a PR for a branch that does not yet exist on the Forgejo `review` remote (i.e. the first push for a new mission branch).

Observed during the task-1316 handoff:

    [INFO] Step 2: Updating/Creating Forgejo PR as user qwen (opencode)...
    [INFO] Pushing mission/task-1316 as Forgejo user magnus (force-with-lease)...
    [FAIL] Forgejo PR creation/update failed: failed to fetch tracking ref for mission/task-1316: fatal: could not find remote ref refs/heads/mission/task-1316
    Automated handoff failed ... Handoff error is not automatically repairable.

Root cause: in `buildCreatePrPushArgs` (lib/tools/forgejo.js ~785-826) when `forceWithLease` is set, `resolveTrackingBranchSha(branch)` fails because there is no `refs/remotes/review/<branch>` yet. The code then calls `gitFetch` (`fetchReviewBranch`), which runs `git fetch review +refs/heads/<branch>:refs/remotes/review/<branch>`. For a brand-new branch that ref does not exist on the remote, so git exits non-zero with "could not find remote ref refs/heads/<branch>", and the function returns a fatal error that aborts the whole PR creation.

A first-time push has nothing to clobber, so it should fall back to a plain push (no `--force-with-lease`) when the remote branch genuinely does not exist, instead of treating "remote ref not found" as a fatal error. A missing remote ref must be distinguished from a real fetch failure (network/auth), which should still surface as an error.

Workaround for the current mission: `px review task-1316 --submit`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 createPr/buildCreatePrPushArgs succeeds for a branch that does not yet exist on the review remote by performing a normal (non-force-with-lease) push instead of failing
- [x] #2 A 'could not find remote ref' fetch result is treated as 'new branch' (fall back to plain push), while genuine fetch failures (network/auth) still return an error and abort
- [x] #3 Existing force-with-lease behavior for branches that DO exist on the remote is unchanged (stale-info retry path still works)
- [x] #4 Regression test covers first-push PR creation where the remote branch is absent and asserts a plain push is used
- [x] #5 Regression test covers a non-not-found fetch failure still returning an error
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced live on 2026-06-15: `node px.js review task-1316 --submit` failed twice with `failed to fetch tracking ref for mission/task-1316: could not find remote ref refs/heads/mission/task-1316`. Confirmed `mission/task-1316` did not exist on the `review` remote at the time. Manual unblock: a one-time plain push creating the remote branch (`git push <authed-url> mission/task-1316:mission/task-1316`), after which `--submit` succeeded (PR #3, task transitioned to review). This confirms the only missing piece is a first-push-without-remote-ref fallback inside `buildCreatePrPushArgs`.
<!-- SECTION:NOTES:END -->
