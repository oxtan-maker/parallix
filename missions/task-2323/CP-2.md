# CP-2 — remaining success paths wired + regression coverage

## Summary

Wired the shared `verifyBaseAncestry()` helper (added in CP-1) into the two
remaining success paths of `px rebase`:

- the mission-specific auto-resolve path, immediately after the final
  `rebaseCompleted` check and before `fmt.log.pass('Mission-specific conflicts
  resolved. Rebase completed.')` (SC4);
- the agent-assisted path, after `finalRebaseCheck` confirms the rebase is no
  longer in progress and before `fmt.log.pass('Agent (…) completed conflict
  resolution.')` (SC5).

Both guards run before `performPush()`, so a branch that fails the postcondition
is never pushed and no success line is printed. All three inlined call sites use
the single helper, so no `exitFn` wrapper refactor was needed (Stop Rules
respected). The mid-rebase `exitFn(0)` exits (`rebase --show-current` non-empty,
and the "agent completed their round" case) remain unguarded by design: they
explicitly report that the rebase is still in progress rather than claiming
success, and the base cannot yet be an ancestor there.

Added five regression tests to `test/rebase.test.ts`, including a local
`isAncestryCheck()` helper that recognizes the `merge-base --is-ancestor` call
after the leading `-C`/`-c` global options. Coverage: the false-success
reproduction (exit 1 + diagnostics + no push), the clean path (exact argv
`['merge-base','--is-ancestor','main','HEAD']`), the mission-specific
conflict-resolved path, the agent-assisted path, and an agent-path ancestry
failure.

`test/rebase.test.ts` went from 37 to 42 tests, all passing. The full gate
`./scripts/verify-local.sh all` exits 0 with 0 failures.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: every success `exitFn(0)` path routes through the shared ancestry assertion running `git merge-base --is-ancestor <baseBranch> HEAD` in the execution root | `src/platform/runtime/lib/commands/rebase.ts:131`, call sites at `src/platform/runtime/lib/commands/rebase.ts:161`, `src/platform/runtime/lib/commands/rebase.ts:441`, `src/platform/runtime/lib/commands/rebase.ts:487` | PASS |
| SC2: ancestry failure exits 1 and prints base branch, mission HEAD sha, and `git rebase --abort` | `src/platform/runtime/lib/commands/rebase.ts:135`, `src/platform/runtime/lib/commands/rebase.ts:136`, `src/platform/runtime/lib/commands/rebase.ts:138`; `"rebase exits 1 when base is not an ancestor of HEAD"` | PASS |
| SC2 (diagnostics distinguish local-base ancestry from `origin/mission/*` tracking divergence) | `src/platform/runtime/lib/commands/rebase.ts:137`; assertion on `/origin\/mission/` in `"rebase exits 1 when base is not an ancestor of HEAD"` | PASS |
| SC3: clean-rebase path verifies ancestry before "Rebase completed cleanly." | `src/platform/runtime/lib/commands/rebase.ts:161`, `src/platform/runtime/lib/commands/rebase.ts:163`; `"rebase clean rebase verifies ancestry before reporting success"` | PASS |
| SC4: mission-specific auto-resolve path verifies ancestry after `rebaseCompleted` and before its success line | `src/platform/runtime/lib/commands/rebase.ts:441`, `src/platform/runtime/lib/commands/rebase.ts:442`; `"rebase mission-specific resolution verifies ancestry before reporting success"` | PASS |
| SC5: agent-assisted path rechecks ancestry after `finalRebaseCheck` and before "Agent … completed conflict resolution." | `src/platform/runtime/lib/commands/rebase.ts:487`, `src/platform/runtime/lib/commands/rebase.ts:489`; `"rebase agent-assisted rebase rechecks ancestry after conflict resolution"` | PASS |
| SC6: "Already up to date" path verifies ancestry before reporting success (shared guarded block entered by the up-to-date branch condition) | `src/platform/runtime/lib/commands/rebase.ts:147`, `src/platform/runtime/lib/commands/rebase.ts:161` | PASS |
| SC7: test asserts non-zero exit plus base branch, HEAD sha, and `git rebase --abort` in output | `test/rebase.test.ts:754`, `"rebase exits 1 when base is not an ancestor of HEAD"` | PASS |
| SC8: test asserts the ancestry `gitFn` call is invoked on the clean path | `test/rebase.test.ts:798`, `"rebase clean rebase verifies ancestry before reporting success"` | PASS |
| SC9: test asserts the ancestry check runs on the agent path | `test/rebase.test.ts:861`, `"rebase agent-assisted rebase rechecks ancestry after conflict resolution"` | PASS |
| No false-success push: ancestry failure suppresses `performPush()` and the success line | `"rebase exits 1 when base is not an ancestor of HEAD"` (asserts `pushed === false` and no `/Rebase completed cleanly/`), `"rebase agent-assisted rebase exits 1 when ancestry fails after conflict resolution"` | PASS |
| SC10: rebase suite passes with no new failures | `npm test -- test/rebase.test.ts` | PASS |
| Gate: full verification suite | `./scripts/verify-local.sh all` | PASS |
| Mandatory integration gate ran | `./scripts/verify-local.sh integrate` | PASS |
| Restricted areas untouched (`review/rebase.ts`, `mission-utils/worktree.ts`, `core/git.ts`) | `git diff --name-only HEAD~2..HEAD` lists only `src/platform/runtime/lib/commands/rebase.ts`, `test/rebase.test.ts`, and mission docs; `src/platform/runtime/lib/review/rebase.ts`, `src/platform/runtime/lib/core/mission-utils/worktree.ts`, `src/platform/runtime/lib/core/git.ts` unchanged | PASS |

Next action: hand off task-2323 to review — the ancestry postcondition is committed on `mission/task-2323` with CP-1/CP-2 evidence; a reviewer can re-verify with `npm test -- test/rebase.test.ts` and `./scripts/verify-local.sh all`.
