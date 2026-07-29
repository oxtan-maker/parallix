# CP-1 — shared ancestry assertion + clean / already-up-to-date paths

## Summary

Added a shared `verifyBaseAncestry()` helper inside `rebase()` in
`src/platform/runtime/lib/commands/rebase.ts`. It runs
`git merge-base --is-ancestor <baseBranch> HEAD` in the execution root through the
existing injected `gitFn` (no new wrapper in `core/git.ts`, per Restricted Areas).
On failure it prints the resolved local base branch name, the mission HEAD sha
(read via `git rev-parse HEAD`), an explicit note that this is local-base ancestry
rather than `origin/mission/*` tracking divergence, and the recovery command
`git rebase --abort`, then calls `exitFn(1)` and returns `false` so the caller
returns without reporting success.

Wired it into the `rebaseResult.status === 0 || /up to date/` block, before
`fmt.log.pass('Rebase completed cleanly.')` and before `performPush()`, so no
false-success message is printed and no push happens when the postcondition
fails. That single block serves both the clean-rebase and the "Already up to
date" success paths (SC3 and SC6).

The mid-rebase `exitFn(0)` at the `--show-current` non-empty branch is
deliberately left unguarded: it explicitly reports that the rebase is still in
progress and is not a success claim; asserting ancestry there would fail by
construction.

Existing suite unaffected: `npm test -- test/rebase.test.ts` → 37 pass, 0 fail.
The default `gitFn` fakes in that file return `{status: 0}` for unrecognized
argument vectors, so the new `merge-base` call resolves as an ancestor there.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 (partial): shared ancestry helper exists and calls `git merge-base --is-ancestor <baseBranch> HEAD` in the execution root | `src/platform/runtime/lib/commands/rebase.ts:130`, `src/platform/runtime/lib/commands/rebase.ts:131` | PASS |
| SC2: failure prints base branch, HEAD sha, and `git rebase --abort`, then exits 1 | `src/platform/runtime/lib/commands/rebase.ts:133`, `src/platform/runtime/lib/commands/rebase.ts:135`, `src/platform/runtime/lib/commands/rebase.ts:138` | PASS |
| SC2 (diagnostic distinguishes local-base ancestry from `origin/mission/*` divergence) | `src/platform/runtime/lib/commands/rebase.ts:137` | PASS |
| SC3: clean-rebase path verifies ancestry before "Rebase completed cleanly." and before push | `src/platform/runtime/lib/commands/rebase.ts:161`, `src/platform/runtime/lib/commands/rebase.ts:163` | PASS |
| SC6: "Already up to date" path verifies ancestry before reporting success (same guarded block, entered via the up-to-date branch condition) | `src/platform/runtime/lib/commands/rebase.ts:147`, `src/platform/runtime/lib/commands/rebase.ts:161` | PASS |
| Restricted area respected: ancestry runs through existing `gitFn`, no `core/git.ts` wrapper added | `src/platform/runtime/lib/commands/rebase.ts:131` | PASS |
| No regression in existing rebase coverage | `` `npm test -- test/rebase.test.ts` `` → tests 37 / pass 37 / fail 0 | PASS |
| SC4, SC5, SC7–SC10 | deferred to CP-2 (`test/rebase.test.ts`, `` `./scripts/verify-local.sh all` ``) | PENDING |

Next action: wire `verifyBaseAncestry()` into the `rebaseCompleted` mission-specific auto-resolve success path (`src/platform/runtime/lib/commands/rebase.ts:440`) and the post-`finalRebaseCheck` agent-assisted success path (`src/platform/runtime/lib/commands/rebase.ts:486`), then add the SC7–SC9 regression tests to `test/rebase.test.ts` and run `./scripts/verify-local.sh all`.
