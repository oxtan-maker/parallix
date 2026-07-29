# Mission: make px rebase verify local base ancestry before reporting success (task-2323)

## Goal
Add a `git merge-base --is-ancestor <base-branch> HEAD` postcondition check on every success path of `px rebase` so the command exits non-zero (never reports success) when the resolved local base branch is not an ancestor of the mission HEAD.

## Why Now
`px rebase` reported a successful rebase of `mission/task-2225` onto a selected local base, but the completed branch did not contain that base commit (`git merge-base --is-ancestor <base> HEAD` exits 1). This false-success is silent — the operator proceeds assuming the branch is rebased, which can cause integration failures later. The regression affects all rebase paths (clean, conflict-resolved, agent-assisted) and must be locked before any further rebase work.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one new assertion function shared across 4 exit-0 paths in a single file, plus 4–5 focused unit tests

## Scope
- `src/platform/runtime/lib/commands/rebase.ts` — add one shared ancestry-assertion helper and call it on every path that currently calls `exitFn(0)` with a success message
- `test/rebase.test.ts` — regression tests for clean rebase, conflict-resolved rebase, agent-assisted rebase, and the false-success reproduction
- Diagnostics on failure: resolved base branch name, mission HEAD sha, and a recovery command (`git rebase --abort`)
- The check uses the same `baseBranch` variable already resolved via `resolveMissionBaseBranchFn(slug, executionRoot, { gitFn })` so feature-branch bases (e.g. `skunkworks`) are correctly covered

## Out of Scope
- Changing the base-branch selection logic (`resolveMissionBaseBranch`)
- Fetching or tracking `origin/mission/*` divergence in the ancestry check (that is informational only)
- Modifying the conflict-classification or agent-prompt logic
- Changes to `src/platform/runtime/lib/review/rebase.ts` (pre-review rebase) — that module delegates to the CLI and inherits the fix automatically

## Success Criteria
- SC1: Every `exitFn(0)` success path in `rebase.ts` passes through a shared ancestry assertion that runs `git merge-base --is-ancestor <baseBranch> HEAD` in the execution root.
- SC2: When ancestry fails, `px rebase` exits with code 1 and prints the resolved base branch name, the mission HEAD sha, and the command `git rebase --abort` as a recovery hint.
- SC3: The clean-rebase path (no conflicts, `rebaseResult.status === 0`) verifies ancestry before printing "Rebase completed cleanly." and calling `exitFn(0)`.
- SC4: The mission-specific auto-resolve path verifies ancestry after the final `rebaseCompleted` check and before printing "Mission-specific conflicts resolved. Rebase completed."
- SC5: The agent-assisted resolution path verifies ancestry after `finalRebaseCheck` confirms rebase is complete and before printing "Agent completed conflict resolution."
- SC6: The "Already up to date" path verifies ancestry before reporting success.
- SC7: A test named `rebase exits 1 when base is not an ancestor of HEAD` asserts the non-zero exit and that the output contains the base branch name, HEAD sha, and `git rebase --abort`.
- SC8: A test named `rebase clean rebase verifies ancestry before reporting success` asserts the ancestry `gitFn` call is invoked on the clean path.
- SC9: A test named `rebase agent-assisted rebase rechecks ancestry after conflict resolution` asserts the ancestry check runs on the agent path.
- SC10: `test/rebase.test.ts` and `./scripts/verify-local.sh static-analysis` pass with no new failures.

## Risks and Assumptions
- The `gitFn` mock in existing tests returns `{ status: 0, stdout: '', stderr: '' }` by default; the new `merge-base --is-ancestor` call must be mocked explicitly in tests that exercise success paths, otherwise its exit code may not be 0.
- The ancestry check is a synchronous `gitFn` call; it adds negligible latency to the success path.
- The `baseBranch` variable is already in scope on all success paths (resolved once at line 123), so no plumbing is needed.
- If `git merge-base --is-ancestor` is not available on the operator's Git version (unlikely, it dates to Git 1.7.2), the command falls back to its existing behavior — this is an assumption, not a tested guarantee.

## Checkpoints
- CP 1: Implement the shared ancestry-assertion helper and wire it into the clean-rebase and "Already up to date" success paths.
- CP 2: Wire the ancestry assertion into the mission-specific auto-resolve path and the agent-assisted path. Add all regression tests.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/platform/runtime/lib/commands/rebase.ts:123` (must point to an existing file and line)
  2. **Test names** — e.g., `"rebase exits 1 when base is not an ancestor of HEAD"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/rebase.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm test -- test/rebase.test.ts` ``, `` `git merge-base --is-ancestor main HEAD` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Ancestry assertion on clean path | `src/platform/runtime/lib/commands/rebase.ts:130` | PASS |
| Test covers false-success exit | `test/rebase.test.ts`, `"rebase exits 1 when base is not an ancestor of HEAD"` | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/platform/runtime/lib/review/rebase.ts` — this module delegates to the `px rebase` CLI and inherits the fix automatically; do not modify it directly
- `src/platform/runtime/lib/core/mission-utils/worktree.ts` — `resolveMissionBaseBranch` is used as-is; do not change its contract
- `src/platform/runtime/lib/core/git.ts` — do not add a wrapper for `merge-base --is-ancestor`; call it through the existing `gitFn`

## Stop Rules
- Do not add a new CLI flag or config option for the ancestry check — it is always-on.
- Do not modify the conflict-classification logic, agent prompt, or `parseConflictFilesFrom*` functions.
- Do not change the base-branch resolution (`resolveMissionBaseBranchFn`) or its fallback chain.
- If more than 4 success paths need wiring, re-evaluate whether the assertion should be extracted to a wrapper around `exitFn` instead of inlined — but do not start that refactor in this mission.
