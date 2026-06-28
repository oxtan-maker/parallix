# Mission: Fix confusing px shell-init error when base worktree directory is missing (task-1381)

## Goal

Eliminate the `[px] ERROR: target directory '/tmp/integrate-v2-root' not found.` message that appears in the user's terminal after a successful `px integrate` run, by preventing the shell function from emitting an error when the integrate command's transition signal points to a non-existent directory.

## Why Now

Users report repeated confusing error messages after successful integrate runs. The error originates from the `px` shell integration function (installed via `px shell-init`) which tries to `cd` into a directory specified by the integrate command's `[INFO] Next: cd …` transition signal. When that directory (typically a base worktree resolved via `resolveBaseWorktree`) does not exist, the shell function prints an opaque error instead of silently skipping the directory change. This creates a perception of failure even though the integration itself succeeded.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: User-reported confusing error after successful integrate; two-file fix (px.js shell function + integrate.js guard); well-contained scope with existing test coverage for shell-init.

## Scope

- `px.js` — `shellInit()` function: when the extracted target directory does not exist, skip the `cd` silently (no error output, no non-zero exit).
- `lib/commands/integrate.js` — `integrate()` function: before emitting `nextActionMessage = \`Next: cd ${baseWorktree}\``, verify the directory exists; skip the signal if it does not.
- `test/px-shell-init.test.js` — add a reproduction test that exercises the missing-directory path.

## Out of Scope

- Fixing the underlying cause of why a base worktree path is recorded but the directory is absent (that would be a separate investigation into `resolveBaseWorktree` and worktree lifecycle).
- Changes to `cleanupMissionWorktree` or worktree creation/deletion logic.
- Changes to Forgejo sync, squash-merge, or other integrate variants.
- Changes to the shell function's behavior when the directory DOES exist (must continue to `cd` and print the success message).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. When the `px` shell function receives a `Next: cd` or `Working directory:` signal pointing to a directory that does not exist, no error text is written to stderr and the shell function exits with code 0.
2. When the target directory DOES exist, the shell function performs the `cd` and prints `[px] Switched terminal context to: <path>` — behavior is unchanged from the pre-fix state.
3. The `px integrate` command emits the `Next: cd …` signal only when `fs.existsSync(baseWorktree)` returns true; when the directory is absent, no `Next: cd` signal is emitted.
4. A new reproduction test in `test/px-shell-init.test.js` exists that fails before the fix (stderr contains `ERROR: target directory`) and passes after the fix (no error output, exit code 0).
5. All 1729 existing tests continue to pass after the changes.

## Risks and Assumptions

- **Risk:** Silently skipping the `cd` may mask a genuine setup problem (e.g., base worktree was deleted). Mitigation: the user's terminal stays in whatever directory they were in, and they can manually `cd` to the expected path. The integrate command's success output still confirms the integration completed.
- **Assumption:** The integrate command's transition signal is informational, not a hard requirement — the user can always manually navigate to the base worktree.
- **Assumption:** The `px` shell function's exit code should reflect the underlying `px` runner's exit code, not the directory-switch result. The fix does not alter exit-code propagation.
- **Assumption:** Both bash and zsh variants of the shell function must behave identically (no error for missing directory).

## Checkpoints

- CP 1: Author a failing reproduction test in `test/px-shell-init.test.js` that exercises the missing-directory path. The test must fail before the fix (stderr contains `ERROR: target directory`) and pass after the fix (no error output, exit code 0).
- CP 2: Fix `px.js` `shellInit()` function: when the target directory does not exist, skip the `cd` silently (no error output, no non-zero exit). Both bash and zsh variants must behave identically.
- CP 3: Add a guard in `lib/commands/integrate.js` `integrate()` function: before emitting `nextActionMessage`, verify `fs.existsSync(baseWorktree)` and skip the signal if the directory is absent.
- CP 4: Run `npm test` — all 1729+ tests pass, including the new reproduction test.

## Gates

- [ ] npm test

## Restricted Areas

- Do not modify `lib/commands/integrate.js` beyond the `nextActionMessage` emission point (around lines 602, 647, 772) and the `finally` block where it is printed (line ~800).
- Do not modify `cleanupMissionWorktree`, `resolveBaseWorktree`, `conventionalWorktreePath`, or any worktree lifecycle functions.
- Do not modify the shell function's behavior for the happy path (when the directory exists).
- Do not modify any test files except `test/px-shell-init.test.js` (addition only, no deletions or renames).

## Stop Rules

- Stop if the fix requires changes outside `px.js`, `lib/commands/integrate.js`, and `test/px-shell-init.test.js`.
- Stop if the fix would alter the shell function's behavior when the target directory exists (cd + success message must remain identical).
- Stop if `npm test` reveals regressions in existing shell-init tests (lines 48-124 of `test/px-shell-init.test.js`).
- Stop if the underlying cause of the missing base worktree directory requires investigation beyond the two-file scope.

Reproduction-Test: test/px-shell-init.test.js
