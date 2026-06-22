# Mission: Fix first-push PR creation when branch has no remote tracking ref (task-1317)

## Goal
Fix `buildCreatePrPushArgs` in `lib/tools/forgejo.js` so that when `forceWithLease` is true and the remote branch does not yet exist on the `review` remote, the function detects the "could not find remote ref" condition from `fetchReviewBranch` and falls back to a plain `git push` (no `--force-with-lease`) instead of returning a fatal error. This unblocks `px review <task> --submit` for the first push of every new mission branch.

## Why Now
The bug has already blocked at least one mission (task-1316) in production. Every new mission branch hits this failure on its first `--submit` because `createPr` always passes `forceWithLease: true`, and `buildCreatePrPushArgs` treats a missing remote ref identically to a network or auth failure. The workaround (`px review task-xxx --submit || git push <authed-url> mission/task-xxx:mission/task-xxx && px review task-xxx --submit`) is fragile and breaks the automated handoff UX.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: production blocker on every new mission branch; narrow root cause with a clear patch surface in `buildCreatePrPushArgs`; regression tests in `test/forgejo.test.js`.

## Scope
- Modify `buildCreatePrPushArgs` (`lib/tools/forgejo.js:785-826`) to inspect the stderr/stdout of `gitFetch` (the `fetchReviewBranch` call at line 807) and detect when the failure reason is "could not find remote ref refs/heads/<branch>" (or equivalent git exit-code 1 with that message).
- When the "new branch" condition is detected, skip `--force-with-lease` entirely and proceed with `pushArgs.push(remoteUrl, branch)` as a plain first-time push.
- All other `gitFetch` failures (non-zero exit code with messages other than "could not find remote ref") must still return `{ok: false, error: ...}` to preserve the error-abort contract.
- When `refreshTrackingRef` is true and `gitFetch` fails with "could not find remote ref", treat it the same way: fall back to plain push instead of the early-return error at line 798.
- Add two regression tests to `test/forgejo.test.js`:
  1. `createPr` with `forceWithLease: true` on a branch absent from the `review` remote uses a plain push (no `--force-with-lease` flag).
  2. `createPr` with `forceWithLease: true` on a branch absent from the `review` remote where `gitFetch` fails with a non-not-found error (e.g., auth/network) returns `{ok: false}`.
- Preserve existing force-with-lease behavior for branches that DO exist on the remote (the stale-info retry path at lines 806-814 must be unchanged).

## Out of Scope
- Changes to `fetchReviewBranch` itself (the fetch logic is correct; only the caller's interpretation of the result needs to change).
- Changes to `resolveTrackingBranchSha` or any other ref-resolution helper.
- Changes to `syncMerged`, `postReview`, or any other Forgejo workflow function.
- Changes to the `px` CLI entry point or handoff orchestration logic.
- Adding CI configuration or modifying `.gitignore`/package metadata.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. `buildCreatePrPushArgs('mission/task-999', '<url>', {forceWithLease: true, gitFetch: mockFailNotFound})` returns `{ok: true, pushArgs: ['-C', '<root>', 'push', '<url>', 'mission/task-999']}` — no `--force-with-lease` in pushArgs.
2. `buildCreatePrPushArgs('mission/task-999', '<url>', {forceWithLease: true, gitFetch: mockFailAuth})` returns `{ok: false, error: <non-empty>}` — auth/network failures still abort.
3. `buildCreatePrPushArgs('mission/task-999', '<url>', {forceWithLease: true, gitFetch: mockSuccess})` returns `{ok: true, pushArgs: [..., '--force-with-lease=refs/heads/mission/task-999:<sha>']}` — existing branch path still uses force-with-lease.
4. `createPr('mission/task-999', 'user', 'token', {forceWithLease: true, ...})` with mocked git that simulates a missing remote ref produces a plain `git push` (verified by inspecting git calls — no `--force-with-lease` flag present).
5. `createPr('mission/task-999', 'user', 'token', {forceWithLease: true, ...})` with mocked git that simulates an auth failure on fetch returns `{ok: false}` and does not proceed to push.
6. All existing tests in `test/forgejo.test.js` pass unchanged (zero regressions).
7. `npm test` completes with zero failures.

## Risks and Assumptions
- Assumption: The "could not find remote ref" message format is stable across git versions used by parallix operators. If git outputs a variant (e.g., "couldn't find remote ref"), the detection must handle it.
- Assumption: A plain push (without `--force-with-lease`) is safe for first-time branch creation — there is nothing to clobber on the remote side.
- Risk: If the remote branch was deleted between the time the agent started working and the push, the plain push would create a new branch but may not include the expected upstream state. This is acceptable because the agent's local branch is the authoritative source for the mission work.
- Risk: The stderr parsing approach is slightly brittle compared to checking git exit codes, but git fetch does not expose a structured error for "ref not found" — it always exits with status 128 and prints the message to stderr.

## Checkpoints
- CP 1: Root cause verification — confirm the exact git stderr output for "could not find remote ref" and design the detection logic (string match on stderr, exit code 128).
- CP 2: Implementation + tests — patch `buildCreatePrPushArgs`, add two regression tests, run full `npm test` with zero failures.

## Gates
- [ ] All 7 acceptance criteria verified via test assertions or manual inspection.
- [ ] `npm test` passes with zero failures.
- [ ] No changes outside `lib/tools/forgejo.js` and `test/forgejo.test.js`.

## Restricted Areas
- Do not modify `fetchReviewBranch`, `resolveTrackingBranchSha`, `syncMerged`, `postReview`, `forgejoApi`, or any function outside `buildCreatePrPushArgs`.
- Do not add new dependencies or change the `module.exports` shape of `forgejo.js`.
- Do not modify the backlog task file's `assignee` field.
- Do not create or modify milestone files.
- Do not commit or push changes; the harness manages version control.

## Stop Rules
- Stop before adding detection logic for edge cases beyond "could not find remote ref" (e.g., permission denied on the ref itself vs. the entire remote).
- Stop before modifying any code path outside `lib/tools/forgejo.js` and `test/forgejo.test.js`.
- Stop before introducing any non-test changes that touch `lib/agents/`, `lib/commands/`, `px.js`, or `backlog/`.
- Stop if the git stderr format differs significantly from the documented "could not find remote ref" pattern and requires fragile regex matching — instead, defer with a note.
