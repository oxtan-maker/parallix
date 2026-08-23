# CP-1 — `px rebase` hook bounces on the rebound kernel

## Summary

Every hook-failure bounce in `px rebase` now runs through the rebound kernel
(`src/application/rebound-kernel.ts`). Concretely:

- `src/application/rebase-workflow.ts` no longer imports, re-exports, or calls
  the standalone policy. It gained one helper, `reboundHookFailure(hookOutput,
  classification, retryContinue)`, that calls `rebound({ kind: 'hook-failure',
  hook, operation: 'rebase --continue', output }, …)` with a `verify` that runs
  `git add -A` followed by that site's own `git rebase --continue` and reports
  `ok` when it exits 0 or says "already up to date".
- The post-initial-rebase `while (retryResult.status !== 0)` bounce loop is
  gone: the site makes one kernel call and branches on `fixed` (ancestry check →
  push → exit 0) or `stranded` (existing "Rebase still failed after implementer
  hook fix." message → `git rebase --abort` recovery hint → exit 1).
- `recoverHookFailureFromContinue` collapsed from a `while` loop to a single
  kernel call, used unchanged at all four `rebase --continue` sites.
- The retry-budget seam on the port (`handleHookFailureAutoBounce`) is replaced
  by `onHookFailure(classification, output) => boolean`, an interception seam.
  The pre-review path (`src/adapters/review/rebase.ts`) installs it to record
  hook evidence and decline the in-child bounce, exactly as before — the review
  loop still owns that budget. The adapter wrapper
  (`src/adapters/rebase/rebase-workflow-adapter.ts`) and the `px rebase` command
  re-export were deleted with it.
- The conflict workflow is untouched: conflict detection, the
  conflict-resolution launch, the `runRebaseWorkflow` recursion, and the
  `continueAttempts` / `maxContinueAttempts` budget are unchanged, and the
  kernel's verify at the `--continue` sites reuses `continueRebase()` so it
  still counts against `continueAttempts`.

Budget semantics changed by design (SC5): each occurrence gets a fresh in-memory
budget of 2 instead of one persisted counter shared across the command.

Changed expectations (both in `test/rebase-use-case.test.ts` /
`test/task-2340-hook-rebounce.test.ts`):

- `"rebase use case auto-bounces a hook failure and retries the rebase"` was
  replaced by the three kernel tests below — it injected the removed
  `port.handleHookFailureAutoBounce` seam.
- The `handleHookFailureAutoBounce (rebase.ts)` / `Rebase retry budget —
  regression coverage` describes and the two `rebase handler …` cases in
  `test/task-2340-hook-rebounce.test.ts` were removed: they pinned the deleted
  rebase-side adapter wrapper and its `hookFailureRetryCount` metadata writes.
  All `classifyHookFailure` assertions there survive verbatim, and the
  integrate-side cases stay until CP 4 deletes the shared policy.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 rebase hook failures route through the kernel, not a standalone policy | `git grep -n "bounceHookFailure" src/application/rebase-workflow.ts` and `git grep -n "handleHookFailureAutoBounce" src/application/rebase-workflow.ts` (0 hits each); `rebound({ kind: 'hook-failure' …})` in `src/application/rebase-workflow.ts` | PASS |
| SC1 fixed path: hook failure → launch → passing `rebase --continue` → push | `"rebase use case bounces a hook failure through the kernel and completes when the re-run passes"` in `test/rebase-use-case.test.ts` | PASS |
| SC1 exhausted path: two failed re-runs, exactly two launches, last diagnostic | `"rebase use case strands a hook failure after two failed rebase --continue re-runs"` in `test/rebase-use-case.test.ts` | PASS |
| SC1 `recoverHookFailureFromContinue` is one kernel call, not a loop | `"rebase use case bounces a hook failure raised by rebase --continue and resumes"` in `test/rebase-use-case.test.ts` | PASS |
| SC5 per-occurrence budget, nothing persisted, second occurrence starts full | `"rebase use case starts a second hook occurrence with a full budget of two"` in `test/rebase-use-case.test.ts`; `ADR 0053` (persistence authority) | PASS |
| Conflict workflow and `continueAttempts` budget unchanged | `npm test -- test/rebase.test.ts test/rebase_hardening.test.ts test/rebase_diagnostics.test.ts test/task-1272-standalone-rebase.test.ts` (62 tests, 0 fail) | PASS |
| Pre-review hook path still declines the in-child bounce | `port.onHookFailure` in `src/adapters/review/rebase.ts`; `npm test -- test/task-2377-02-pre-review-rebase-inprocess.test.ts test/task-2377.03-rebound-kernel.test.ts test/task-2377.04-per-round-rebound-cap.test.ts` (38 tests, 0 fail) | PASS |
| CP 1 named suites green | `npm test -- test/rebase.test.ts test/rebase_hardening.test.ts test/rebase_diagnostics.test.ts test/task-1272-standalone-rebase.test.ts test/rebase-use-case.test.ts test/task-2340-hook-rebounce.test.ts` (99 tests, 0 fail) | PASS |
| Lint and typecheck clean on changed files | `npm run typecheck`; `npx eslint src/application/rebase-workflow.ts src/application/ports/rebase-workflow.ts src/adapters/rebase/rebase-workflow-adapter.ts src/adapters/cli/commands/rebase.ts src/adapters/review/rebase.ts` | PASS |

Next action: CP 2 — migrate the `while (commitResult.status !== 0)` squash-commit
bounce loop in `src/adapters/cli/commands/integrate.ts` to `rebound()` with a
verify that re-runs the same `git commit --only -m … -- <intendedPayloadPaths>`,
re-provide the `integrate-post.ts` mock seam as kernel-context injection, and
record the SC9 dead-duplicate verification.
