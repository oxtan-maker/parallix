# Mission: Autotranision to review does not rebase to main (task-1323)

## Goal
Make `performHandoff` in `lib/commands/handoff.js` rebase the mission branch onto the local primary branch before creating or updating the Forgejo PR, so that reviewers always see a branch whose parent commit is the latest main. This eliminates wasted agent-token rounds caused by reviewing code that diverged from main.

## Why Now
PR #10 on the local Forgejo instance consumed a full agent-token round to discover the branch had not been rebased to main. Every subsequent review round on a diverged branch repeats the same waste: the reviewer evaluates implementation against an outdated baseline, and the agent must re-implement fixes that were already merged to main.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: token-waste from reviewing diverged branches, existing `rebaseBeforeReviewRound` in review-loop.js proves the rebase pattern is already solidified

## Scope
- Modify `performHandoff` in `lib/commands/handoff.js` to call `rebaseBeforeReviewRound` (from `lib/review/review-loop.js`) before Step 2 (Forgejo PR create/update).
- The rebase must run in both Forgejo-enabled and Forgejo-disabled modes; when Forgejo is disabled, `rebaseBeforeReviewRound` already commits safe artifacts and skips the rebase gracefully.
- The rebase must respect the existing `--push` flag path: when Forgejo is enabled, the rebase command (`px rebase <slug> --push`) will update the PR after rebasing, so the subsequent `forgejo.createPr` call in handoff becomes a no-op idempotent update. We must avoid double-push conflicts by ensuring the handoff's PR step does not force-push over the rebase push.
- Update `test/handoff.test.js` with at least one test verifying that handoff invokes rebase before the Forgejo PR step, and one test confirming handoff still succeeds when the branch is already up-to-date.

## Out of Scope
- Changes to `lib/commands/rebase.js` (the rebase command itself is out of scope; we only consume it).
- Changes to `lib/review/review-loop.js` `rebaseBeforeReviewRound` signature — we reuse the existing function as-is.
- Changes to `lib/commands/repair-handoff.js` (already handles rebase-on-error; no changes needed there).
- Changes to Forgejo token management, bootstrap, or fallback logic.
- Any changes to the autonomous review loop (`lib/review/review-loop.js` loop body) — the rebase already runs there; we are only adding it to handoff.

## Success Criteria
1. `performHandoff` calls `rebaseBeforeReviewRound` (or an equivalent rebase invocation) before any Forgejo PR creation or update. Verified by adding a test that mocks `rebaseBeforeReviewRound` and asserts it is called with the correct slug and worktree before `forgejo.createPr` is invoked.
2. When `rebaseBeforeReviewRound` returns `{ ok: false, sharedFileConflicts: false }` (rebase failed but no shared-file conflicts), handoff fails with a clear error message and does NOT create or update the Forgejo PR. The task remains in its current status.
3. When `rebaseBeforeReviewRound` returns `{ ok: false, sharedFileConflicts: true }` (shared-file conflicts), handoff fails with a clear error directing the operator to resolve conflicts in the worktree and re-run handoff. No Forgejo PR is created or updated.
4. When the branch is already up-to-date with main (rebase is a no-op), handoff proceeds normally and the Forgejo PR is created/updated as before. Existing test `performHandoff succeeds with valid checkpoint` must still pass.
5. All existing tests in `test/handoff.test.js` pass unchanged (no regression).
6. `npm test` passes with zero failures.

## Risks and Assumptions
- Risk: The rebase step may introduce a race condition where the rebase push and the handoff's `forgejo.createPr` push collide on Forgejo. Mitigation: `rebaseBeforeReviewRound` calls `px rebase <slug> --push` which updates the PR; handoff's `forgejo.createPr` will find an existing PR and update it (idempotent). If force-with-lease is used, the lease check should prevent overwriting the rebase push.
- Risk: `rebaseBeforeReviewRound` expects a `worktree` parameter; handoff operates in the worktree directory already, so the path should be `verification.rootDir`.
- Assumption: The existing `rebaseBeforeReviewRound` function's contract (auto-commits safe mission artifacts, rebases, optionally pushes) is sufficient for handoff's needs without modification.
- Assumption: When Forgejo is disabled, `rebaseBeforeReviewRound` will commit safe artifacts and return `{ ok: true }`, allowing handoff to proceed without a PR (existing behavior).

## Checkpoints
- CP 1: Read and map the handoff → rebase integration points. Identify the exact insertion location in `performHandoff` (between Step 1 verification gate and Step 2 Forgejo PR) and the parameter mapping (slug, worktree, log/error functions).
- CP 2: Implement the rebase call in `performHandoff` with proper error handling for all three `rebaseBeforeReviewRound` return shapes (ok=true, ok=false/no-shared-conflicts, ok=false/shared-conflicts).
- CP 3: Write tests covering: (a) rebase called before PR creation, (b) rebase failure blocks PR creation, (c) shared-file conflict blocks PR creation, (d) branch already up-to-date proceeds normally.
- CP 4: Run `npm test` and verify all handoff tests pass.

## Gates
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- Do not modify `lib/commands/rebase.js` — the rebase command's conflict classification, agent launch, and --theirs resolution logic are proven and out of scope.
- Do not modify `lib/review/review-loop.js` `rebaseBeforeReviewRound` function signature or its internal behavior.
- Do not modify Forgejo token or bootstrap logic in `lib/tools/forgejo.js` or `lib/tools/setup-review.js`.

## Stop Rules
- Stop if `rebaseBeforeReviewRound` cannot be called from handoff without modifying its signature (this would indicate a design mismatch requiring a broader redesign; escalate rather than proceed).
- Stop if existing handoff tests require more than superficial changes to accommodate the rebase call (indicating the test architecture is fragile and needs a separate refactoring mission).
- Stop if the rebase push and handoff PR push cause unresolvable race conditions on Forgejo (test by examining the `createPr` logic for existing-update vs create paths).
