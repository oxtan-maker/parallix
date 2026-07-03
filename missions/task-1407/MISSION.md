# Mission: Snapshot review baseline to avoid spurious "not rebased to main" comments (task-1407)

## Goal

Capture the commit SHA of the primary branch at the start of each review step and pass it into the review and act-on-review prompts so that diff commands compare against that snapshot (`git diff <sha>..HEAD`) instead of the live `{{primaryBranch}}` reference. This prevents reviewers from complaining about changes merged to main by other missions while the review loop is mid-flight.

## Why Now

Task-1403 investigated the "branch reverting stuff due to not rebased to main" review comments and confirmed that rebasing at every review loop is already in place — it is not the root cause. The remaining contributor is that `{{primaryBranch}}` in the prompts resolves to whatever `main` points to at prompt-build time. If another mission integrates between the reviewer launch and the diff inspection, the reviewer sees unrelated changes and generates noise comments. This fix isolates each review to the exact state of main when that review round started.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Spurious review comments from concurrent merges; prompt variables already parameterized; no behavioral change to review outcomes — only the diff baseline shifts.

## Scope

- `lib/review/review-loop.ts`: Capture primary-branch HEAD commit SHA before `rebaseBeforeReviewRound()` fires (around the `if (state.phase === 'reviewing')` block, before the `!reviewState` rebase call). Thread the SHA as `reviewBaseline` through the prompt-builder calls for both the compact and verbose prompt paths.
- `lib/review/review-prompts.ts`: Accept a new `reviewBaseline` parameter on `buildReviewPrompt`, `buildCompactReviewPrompt`, `buildActOnReviewPrompt`, and `buildCompactActOnReviewPrompt`. Substitute `{{reviewBaseline}}` in place of `{{primaryBranch}}` where the prompts reference the diff base. Leave `{{primaryBranch}}` substitution intact for any remaining uses (e.g., branch-name references that are not diff baselines).
- `prompts/review.md`: Replace `git diff {{primaryBranch}}..HEAD` with `git diff {{reviewBaseline}}..HEAD` on the diff requirement line.
- `prompts/review-verbose.md`: Same replacement on the verbose diff requirement line.
- `prompts/act-on-review.md`: No diff command currently; add a note to diff against `{{reviewBaseline}}` if the act-on-review flow inspects a diff (defer if none exists today).
- `prompts/act-on-review-verbose.md`: Same as above.
- `test/review-prompts.test.js`: Add assertions that `{{reviewBaseline}}` is substituted in generated prompts and that no literal `{{reviewBaseline}}` placeholder leaks.

## Out of Scope

- Changing the rebase logic in `rebase.ts` or `review-loop.ts` beyond capturing the baseline SHA.
- Modifying Forgejo/PR review surface behavior.
- Adding new CLI flags or configuration entries.
- Changes to checkpoint documents, backlog tasks, or MISSION.md scaffolding.
- Any change to the `buildReviewPrompt` / `buildActOnReviewPrompt` function signatures that is not strictly needed to pass `reviewBaseline`.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- C1: `prompts/review.md` contains `git diff {{reviewBaseline}}..HEAD` and no longer contains `git diff {{primaryBranch}}..HEAD` on the diff instruction line.
- C2: `prompts/review-verbose.md` contains `git diff {{reviewBaseline}}..HEAD` and no longer contains `git diff {{primaryBranch}}..HEAD` on the diff instruction line.
- C3: `lib/review/review-prompts.ts` `buildCompactReviewPrompt` accepts a `reviewBaseline` parameter and substitutes `{{reviewBaseline}}` with the provided SHA string in the output prompt.
- C4: `lib/review/review-prompts.ts` `buildReviewPrompt` (verbose) accepts a `reviewBaseline` parameter and substitutes `{{reviewBaseline}}` in the output prompt.
- C5: `lib/review/review-loop.ts` captures the primary-branch HEAD commit SHA before calling `rebaseBeforeReviewRound()` and passes it as `reviewBaseline` to the prompt builders (compact and verbose paths).
- C6: `test/review-prompts.test.js` contains at least one assertion verifying that `{{reviewBaseline}}` does not appear literally in a built prompt (i.e., it is substituted).
- C7: `npm test` (the `gate_all` verifier) passes with zero failures after the changes.

## Risks and Assumptions

- **Risk:** The captured SHA becomes stale if the rebase fails or is skipped (e.g., no forgejo provider). **Assumption:** The SHA is captured right before the rebase call regardless; if rebase is skipped, the SHA still represents a valid commit on the primary branch and is safe to diff against.
- **Risk:** Removing `{{primaryBranch}}` from diff lines could break other prompt sections that reference the branch name. **Mitigation:** Only replace `{{primaryBranch}}` in lines that express a diff command; leave branch-name references untouched.
- **Assumption:** The primary branch ref (e.g., `main`) is resolvable via `git rev-parse {{primaryBranch}}^commit` before rebase. If the branch ref is missing, the review loop already fails earlier, so this edge case is harmless.
- **Assumption:** The act-on-review prompts do not currently issue diff commands against `{{primaryBranch}}` (confirmed by inspecting `prompts/act-on-review.md` and `prompts/act-on-review-verbose.md` — neither contains a diff instruction).

## Checkpoints

- CP 1: Capture primary-branch HEAD SHA in `review-loop.ts` before `rebaseBeforeReviewRound()` and thread it through all four prompt-builder calls. Update `review.md` and `review-verbose.md` to use `{{reviewBaseline}}` instead of `{{primaryBranch}}` on diff lines. Add a test assertion in `test/review-prompts.test.js` that `{{reviewBaseline}}` is substituted.
- CP 2: Run `npm test` and `./scripts/verify-local.sh static-analysis` to confirm all existing tests pass and lint/typecheck are clean.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `backlog/` — do not modify backlog task metadata (assignee, status, IDs). The workflow records ownership itself.
- `missions/` — do not modify existing mission contracts or checkpoint documents.
- `lib/review/rebase.ts` — do not change rebase logic; only capture the baseline SHA in `review-loop.ts`.
- `lib/commands/` — no CLI command changes.
- `config/` — no configuration changes.

## Stop Rules

- Stop if capturing the baseline SHA requires changes to `rebase.ts` or the `px rebase` command — escalate for scope review.
- Stop if `npm test` reveals that removing `{{primaryBranch}}` from diff lines breaks other prompt consumers that depend on the branch name — pause and reassess the substitution scope.
- Stop if the captured SHA cannot be resolved (e.g., detached HEAD or missing ref) and the fix would require adding new error-handling paths beyond the existing review-loop guards.
