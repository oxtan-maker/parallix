---
id: TASK-1311
title: >-
  Re-launch implementer with targeted fix prompt when static review finds
  trivial missing items
status: done
assignee: [qwen]
created_date: '2026-06-14 19:23'
labels:
  - ai_sdlc
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When `px review <slug>` is called with no flags and no open PR, `performStaticReview` runs. If it finds issues (missing Goal Check section, no evidence rows, mission dir missing), the current code auto-triggers the full review loop — burning a full reviewer token round on trivia that the implementer should have caught themselves.

The fix: when `performStaticReview` returns findings, do NOT start the review loop. Instead, re-launch the implementer agent with a short, targeted prompt that lists the exact findings and tells them to fix and commit.

**Where the change lives**: `parallix/lib/review/review-commands.js`, in the `review()` function's else-branch (no flags, no open PR), specifically the block starting at `if (staticResult.findings && staticResult.findings.length > 0)`.

**Current code (bad)**:
```js
if (staticResult.findings && staticResult.findings.length > 0) {
  log(`Static review found N finding(s). Auto-triggering review loop...`);
  await submitForReviewFn(slug, true, options);
  postStaticReviewCommentFn(...);
  await startReviewLoopFn(slug, { ...options });
}
```

**Desired behavior**:
1. Read the implementer from the task file via `getTaskImplementer(taskFile)` (already available via `resolveTaskFileFn`)
2. Build a focused prompt listing the static review findings: e.g. "Static review of your mission branch found the following issues. Fix them and commit, then stop:\n- [finding 1]\n- [finding 2]"
3. Call `startAgentFn('active', { prompt, worktree: worktreeForStatic, agent: implementer, slug })` to re-run the implementer — NOT `startReviewLoopFn`
4. Do NOT submit for review, do NOT post a Forgejo comment, do NOT start the review loop

The implementer re-launch should use the same `startAgentFn` that `active.js` uses. If `implementer` cannot be resolved (task file missing or no assignee), fall back to the current behavior (log a warning and do nothing, or log and stop — do not start the review loop either way).

**What NOT to change**: `performStaticReview` itself, the `--verify` path, the `--start`/`--continue` paths, or the `ok: true` (no findings) path. Only the `findings.length > 0` branch changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When `performStaticReview` returns findings, `startReviewLoopFn` is NOT called — confirmed by a unit test that injects both `startReviewLoopFn` and `startAgentFn` as mocks and asserts the former is never called and the latter is called once with step=`'active'`.
- [ ] #2 The prompt passed to `startAgentFn` includes each finding string from `staticResult.findings` as a line item.
- [ ] #3 The `agent` passed to `startAgentFn` is the implementer read from the task file via `getTaskImplementer`. If the implementer cannot be resolved, `startAgentFn` is not called and a WARN is logged instead.
- [ ] #4 When `performStaticReview` returns `ok: true` (no findings), behavior is unchanged — no agent is launched.
- [ ] #5 `./scripts/verify-local.sh parallix` exits 0 after the change.
<!-- AC:END -->
