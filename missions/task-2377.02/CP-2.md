# CP-2 — Parent-side regex deleted, classification moved onto typed evidence

## Summary of work done

- Confirmed the removal of `HOOK_FAILURE_RE` and both of its call sites (the
  `commitSafeMissionArtifacts` commit-failure path and the post-subprocess
  classification path) from `src/adapters/review/rebase.ts`. The commit path now
  reports hook identity from the failing git operation (`commit` → `pre-commit`);
  the post-subprocess path no longer exists. `SHARED_FILE_REBASE_CONFLICT_RE` went
  with it — shared-file conflicts are read from the port's conflict
  classification object instead of from output text.
- Removed the misleading `Hook rebounce available in CLI rebase command`
  diagnostic; the message described a rebounce that had already happened inside
  the subprocess. The replacement names the hook that actually failed.
- Single hook-budget consumer: `rebaseBeforeReviewRound` installs
  `port.handleHookFailureAutoBounce` as a recording seam that returns `false`, so
  the in-process workflow classifies and reports the hook failure but never
  bounces or retries `git rebase --continue`. The review loop remains the only
  process that spends the budget, through `handleGateFailureAutoBounceFn`.
- Propagated the typed result to `src/adapters/review/review-loop.ts`:
  - `failure.kind === 'gate'` (push-time verification gate) is reported as a gate
    failure with area, command, and exit code, and exits — it never reaches the
    hook-bounce branch, even though its output contains `pre-push`.
  - the hook branch now builds its `PreReviewGateResult` from `failure.hook`
    (identity + preserved output), falling back to the previous
    `git commit (pre-review safety commit)` command string for callers that
    return a result without typed evidence.
  - dropped the now-dead `runFn` pass-through to `rebaseBeforeReviewRoundFn`.
- Widened `HandoffRebasePort.rebaseBeforeReviewRound` in
  `src/application/ports/handoff-workflow.ts` to return `PreReviewRebaseOutcome`,
  which keeps `ok` / `sharedFileConflicts` for existing consumers and adds the
  optional `failure` discriminant.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 2 — `HOOK_FAILURE_RE` does not appear in `src/adapters/review/rebase.ts` | `` `git grep -n "HOOK_FAILURE_RE" src/` `` → no matches (exit 1); file `src/adapters/review/rebase.ts`, symbols `commitSafeMissionArtifacts` and `rebaseBeforeReviewRound` | PASS |
| 2 — no regex in that file matches `pre-commit` / `pre-push` / `post-commit` | `` `git grep -nE "pre-commit\|pre-push\|post-commit" src/adapters/review/rebase.ts` `` → 5 matches, all comments or the `hook: 'pre-commit'` string literal set from the failing git operation; no regex literal in the file contains a hook name | PASS |
| 5 — the hook-retry budget is consumed in exactly one process | `"a pre-review rebase hook failure requests the hook bounce at most once"` in `test/task-2377-02-pre-review-rebase-inprocess.test.ts` (asserts `bounceRequests === 1` and zero `git rebase --continue` retries inside the workflow) | PASS |
| 6 — `Hook rebounce available in CLI rebase command` appears nowhere under `src/` | `` `git grep -n "Hook rebounce available in CLI rebase command" src/` `` → no matches (exit 1) | PASS |
| Typed result reaches the review loop and is classified as a gate failure | `"review loop treats a pre-review rebase gate failure as a gate failure, not a hook bounce"` in `test/task-2377-02-pre-review-rebase-inprocess.test.ts` (asserts zero bounces, zero reviewer launches, `exit 1`, and no `Git hook failure` diagnostic) | PASS |
| Typed result reaches `HandoffRebasePort` | `src/application/ports/handoff-workflow.ts`, `HandoffRebasePort.rebaseBeforeReviewRound` returns `PreReviewRebaseOutcome` from `src/application/ports/rebase-workflow.ts`; `test/handoff-use-case.test.ts` passes unmodified | PASS |
| Existing pre-review gate / rebounce suites stay green | `test/task-1268-pre-review-gate-per-round.test.ts`, `test/task-2353-rebounce-reproduction.test.ts`, `test/task-1104-call-order.test.ts`, `test/handoff-use-case.test.ts`, `test/task-1209-review-loop.test.ts` — 32/32 pass | PASS |
| Lint and typecheck clean on changed files | `` `npx tsc --noEmit -p tsconfig.json` ``, `` `npx tsc --noEmit -p tsconfig.test.json` ``, `` `npx eslint src/adapters/review/review-loop.ts src/application/ports/handoff-workflow.ts test/task-2377-02-pre-review-rebase-inprocess.test.ts` `` — all clean | PASS |

Next action: CP-3 — migrate the subprocess-shaped assertions in
`test/task-1107-repro.test.ts` (tsx-entrypoint and compiled-`px.mjs` selection,
combined-output classification) and `test/review.test.ts` to the in-process
contract, listing each changed assertion by test name, check `docs/` for any text
describing the pre-review rebase as a nested CLI call, and run
`./scripts/verify-local.sh all` on the final tree.
