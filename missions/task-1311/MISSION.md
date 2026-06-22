# Mission: Re-launch implementer with targeted fix prompt when static review finds trivial missing items (task-1311)

## Goal

When `px review <slug>` runs with no flags and no open PR, and `performStaticReview` returns findings, replace the current auto-trigger of the full review loop with a re-launch of the implementer agent. The implementer receives a short, targeted prompt listing each finding verbatim and is instructed to fix and commit them. `startReviewLoopFn` must not be called in this path.

## Why Now

Every `px review` call without an open PR burns a full reviewer token round on structural trivia (missing Goal Check section, no evidence rows, mission dir absent) that the implementer should have self-checked. This wastes reviewer capacity and delays delivery. Re-routing to the implementer costs roughly one agent step instead of one full review round.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: reviewer token waste on trivial self-fixable issues, clear code location for change, no behavioral change to review-loop paths

## Scope

- File changed: `parallix/lib/review/review-commands.js`, the `review()` function's else-branch (no flags, no open PR), specifically the block at lines 1215-1227 where `staticResult.findings && staticResult.findings.length > 0`
- Replace `submitForReviewFn + postStaticReviewCommentFn + startReviewLoopFn` with `startAgentFn('active', { prompt, worktree: worktreeForStatic, agent: implementer, slug })`
- Read the implementer from the task file via `getTaskImplementer` (already imported as `getTaskImplementerFn`) using `resolveTaskFileFn(slug, worktreeForStatic)`
- Build the prompt from `staticResult.findings` array items
- Fall back to logging a WARN and doing nothing when the implementer cannot be resolved
- Add one unit test in `test/review-commands.test.js` (or a new supplemental file) that injects mocked `startReviewLoopFn` and `startAgentFn` and asserts the correct call pattern

## Out of Scope

- Changes to `performStaticReview` itself (its logic, output shape, or checks)
- The `--verify` path, `--start`/`--continue` paths, `--submit`, `--push`, `--comment`, `--submit-review`, `--close`, `--status`, `--dry-run`, `--reset`, `--create-event`, `--import-legacy`, `--consume-artifacts`
- The `ok: true` (no findings) branch — behavior is unchanged
- Any Forgejo/PR posting logic beyond what is already in scope
- Changes to prompts used by the implementer in normal `--start`/`--continue` flows
- Migration of existing tasks, milestones, or backlog metadata

## Success Criteria

1. `performStaticReview` returning findings does NOT call `startReviewLoopFn` — verified by a unit test that injects both `startReviewLoopFn` and `startAgentFn` as mocks and asserts `startReviewLoopFn.mock.calls.length === 0` and `startAgentFn` is called exactly once with `step === 'active'`.
2. The prompt string passed to `startAgentFn` contains each element of `staticResult.findings` as a separate line item (one finding per line, preceded by a dash or bullet).
3. The `agent` option passed to `startAgentFn` equals the implementer string returned by `getTaskImplementerFn(taskResolution.taskFile)`. When `getTaskImplementerFn` returns null/undefined (task file missing or no assignee), `startAgentFn` is NOT called and a WARN-level log message is emitted.
4. When `performStaticReview` returns `{ ok: true, findings: [] }`, the existing behavior is preserved — no agent is launched, no review loop starts.
5. All existing tests in `test/review-commands.test.js` and `test/review-commands-supplemental.test.js` continue to pass.
6. `./scripts/verify-local.sh parallix` exits 0 after the change.

## Risks and Assumptions

- Risk: `resolveTaskFileFn(slug, worktreeForStatic)` may return a different worktree than `process.cwd()`. Assumption: the worktree mapping is consistent and the task file is accessible from that worktree.
- Risk: `getTaskImplementerFn` may return null if the task has no assignee. Mitigation: fall back to WARN + no-op, do not crash.
- Assumption: `startAgentFn` (from `../agents/agents`) accepts the same signature (`step`, `opts` with `prompt`, `worktree`, `agent`, `slug`) that the active step uses elsewhere.
- Assumption: the implementer re-launch will self-correct the trivial findings without needing a full review round.
- Risk: If the implementer agent is blocked or unavailable, the WARN log is the only signal — no retry mechanism is included in this task.

## Checkpoints

- CP 1: Code location confirmed, existing behavior documented, test strategy defined (mock injection plan for `startReviewLoopFn` and `startAgentFn`).
- CP 2: Implementation complete — `review-commands.js` else-branch replaced with implementer re-launch logic, fallback path added.
- CP 3: Unit test written and passing, all existing tests still pass.
- CP 4: `./scripts/verify-local.sh parallix` passes, mission complete.

## Gates

- [ ] npm test (all existing tests pass, new test passes)
- [ ] ./scripts/verify-local.sh parallix exits 0

## Restricted Areas

- Do NOT modify `performStaticReview` in `lib/review/review.js` — it is outside scope.
- Do NOT modify any file outside `lib/review/review-commands.js` except for adding a new test file or appending to an existing test file.
- Do NOT change the `--verify`, `--start`, `--continue`, `--submit`, or any other flag handler in `review-commands.js`.
- Do NOT alter the `ok: true` branch (lines 1228-1240).

## Stop Rules

- Stop immediately if modifying the findings branch causes any existing test in `test/review-commands*.test.js` to fail.
- Stop if `resolveTaskFileFn` or `getTaskImplementerFn` signatures differ from what is already imported and used elsewhere in `review-commands.js`.
- Stop if `startAgentFn` does not accept `worktree` and `agent` options — pivot to documenting the gap rather than forcing a mismatch.
- Stop if `./scripts/verify-local.sh parallix` fails due to a pre-existing issue (not introduced by this change).
