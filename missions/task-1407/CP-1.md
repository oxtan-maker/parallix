# Checkpoint 1 (final): reviewBaseline snapshot threaded through review/act-on-review prompts

## Summary

Implemented both mission checkpoints (CP1 code change + CP2 verification) in a single pass since the work is small and self-contained.

- `lib/review/review-loop.ts`: at the top of each round of the `for (let attempt = ...)` loop in `startReviewLoop`, the primary branch's current HEAD commit is snapshotted into a local `reviewBaseline` via `getPrimaryBranch(worktree, gitFn)` + `gitFn(['-C', worktree, 'rev-parse', primaryBranchName])` (factored into a `captureReviewBaseline()` closure). This early capture is a fallback only, used for rounds that never rebase this process invocation (a dry run, or resuming with an already-existing `reviewState`). When `rebaseBeforeReviewRoundFn` does run (the live, first-launch-this-round path), `reviewBaseline` is **re-captured immediately after the rebase succeeds**, before the reviewer is launched. This ordering fix (corrected during round-1 review-feedback follow-up) matters: `px rebase` rewrites HEAD onto primary's current tip, so a SHA captured *before* the rebase is stale the instant the rebase completes — diffing against it would include every commit primary gained since that stale snapshot, reintroducing exactly the "not rebased to main" noise this baseline exists to eliminate. Capturing post-rebase pins the diff to the commit HEAD was actually rebased onto. The capture is wrapped in try/catch, falling back to `undefined` if no primary branch can be detected yet (e.g. in a fresh repo with no commits) — in that case the prompt builders fall back to their pre-existing live `{{primaryBranch}}` resolution, preserving old behavior.
- `reviewBaseline` is threaded into all six prompt-builder call sites in the round loop: the dry-run verbose reviewer prompt, the initial + timeout-recovery compact reviewer prompt launches, the dry-run verbose act-on-review prompt, and the initial + timeout-recovery compact act-on-review prompt launches.
- `lib/review/review-prompts.ts`: `buildReviewPrompt`, `buildCompactReviewPrompt`, `buildActOnReviewPrompt`, and `buildCompactActOnReviewPrompt` all accept an optional `reviewBaseline?: string` parameter and substitute `{{reviewBaseline}}` in the rendered template, defaulting to the existing `resolvePrimaryBranch(repoRoot)` live-ref resolution when the caller omits it (keeps all pre-existing callers/tests working unchanged).
- `prompts/review.md` and `prompts/review-verbose.md`: the diff instruction lines now read `git diff {{reviewBaseline}}..HEAD` instead of `git diff {{primaryBranch}}..HEAD`. `{{primaryBranch}}` substitution itself is left intact in the builders for any other future use, but no `.md` template currently references it.
- `prompts/act-on-review.md` / `prompts/act-on-review-verbose.md`: confirmed (via grep) neither file issues a diff command, so no changes were needed there per the mission's deferral note. The builder functions still accept `reviewBaseline` for signature consistency across all four builders.
- `test/review-prompts.test.js`: added two new tests asserting `{{reviewBaseline}}` is substituted with the caller-supplied SHA in both `buildCompactReviewPrompt` and `buildReviewPrompt` (verbose), and that no literal `{{reviewBaseline}}` placeholder leaks into the rendered prompt.

## Goal Check

| Success Criterion | Evidence | Status |
|---|---|---|
| C1: `prompts/review.md` uses `{{reviewBaseline}}`, not `{{primaryBranch}}`, on the diff line | `prompts/review.md:10` → `` - diff: `git diff {{reviewBaseline}}..HEAD` `` | PASS |
| C2: `prompts/review-verbose.md` uses `{{reviewBaseline}}`, not `{{primaryBranch}}`, on the diff line | `prompts/review-verbose.md:12` → `` - {{repo_line}}review the full mission diff using `git diff {{reviewBaseline}}..HEAD` `` | PASS |
| C3: `buildCompactReviewPrompt` accepts `reviewBaseline` and substitutes it | `lib/review/review-prompts.ts:135-155` (param at 135, `.replaceAll('{{reviewBaseline}}', reviewBaseline \|\| primaryBranch)` at 155); test `test/review-prompts.test.js:211` "buildCompactReviewPrompt substitutes {{reviewBaseline}} with the provided SHA and leaks no placeholder" | PASS |
| C4: `buildReviewPrompt` (verbose) accepts `reviewBaseline` and substitutes it | `lib/review/review-prompts.ts:75-99` (param at 75, `.replaceAll('{{reviewBaseline}}', ...)` at 96); test `test/review-prompts.test.js:225` "buildReviewPrompt (verbose) substitutes {{reviewBaseline}} with the provided SHA and leaks no placeholder" | PASS |
| C5: `review-loop.ts` captures primary-branch HEAD SHA and threads it into compact + verbose prompt builders | `lib/review/review-loop.ts:996-1010` (fallback pre-rebase capture, used only when this round doesn't rebase); `lib/review/review-loop.ts:1058` (authoritative re-capture immediately after `rebaseBeforeReviewRoundFn` succeeds at `:1047`, before the reviewer is launched — see round-1 review-feedback fix below); threaded at call sites `review-loop.ts:1041` (verbose dry-run), `:1115` and `:1180` (compact reviewer), `:1317` (verbose act-on-review dry-run), `:1335` and `:1397` (compact act-on-review) | PASS |
| C6: `test/review-prompts.test.js` asserts `{{reviewBaseline}}` does not leak literally | `test/review-prompts.test.js:222` and `:235` — `assert.doesNotMatch(prompt, /\{\{reviewBaseline\}\}/);` | PASS |
| C7: `npm test` passes with zero failures | `npm test` → `tests 1808 / pass 1786 / fail 0 / skipped 22` (22 pre-existing skips, unrelated to this change) | PASS |

Additional verification: `./scripts/verify-local.sh static-analysis` → ESLint clean, `tsc typecheck` clean, test-hygiene clean. `./scripts/verify-local.sh all` (mission's declared Gate) → same 1808/1786/0 result, PASS.

## Next action

None — all mission success criteria and the declared gate (`./scripts/verify-local.sh all`) pass; ready for handoff to review.
