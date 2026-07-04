# Mission: Prevent integrate from corrupting main when restoring a dirty integration checkout (task-1410)

## Goal

Eliminate the corruption vector where `px integrate` leaves the primary (`main`) checkout with unmerged index entries, duplicate task files, or deleted tracked backlog files after restoring stashed local changes. The fix ensures that when the primary checkout is dirty and its dirty paths overlap files that integrate mutuates during closeout, integrate either blocks before landing changes with a clear recovery message or uses an isolation mechanism that preserves those edits safely without ever corrupting the working tree.

## Why Now

On July 3, 2026, the `task-1404` integration left `main` with an unmerged index entry for `backlog/archive/tasks/task-1404 - stop-false-Codex-Mistral-autoblocks-and-persist-blocklist-reasons.md`, a deleted tracked `task-1403` file, and a stray untracked `task-1404` task copy. The root cause is in `lib/commands/integrate.ts`: `stashMainCheckoutIfNeeded()` stashes any dirty primary checkout state, the closeout path calls `completeTask()` and `rewriteWorktreePaths()` in the same checkout (mutating backlog task files), then `restoreMainCheckoutStash()` runs a plain `git stash pop` in the `finally` block that can collide with files integrate just edited or moved. Until this is fixed, any integrate on a dirty main checkout risks the same corruption pattern.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: production corruption incident (task-1404), clear code paths identified, contained scope within integrate.ts, deterministic reproduction possible

## Scope

- `lib/commands/integrate.ts`: `stashMainCheckoutIfNeeded()`, `restoreMainCheckoutStash()`, and the closeout flow between them (Variant A and Variant B paths)
- `lib/commands/integrate.ts`: `printIntegrationPreflight()` dirty-check logic — upgrade overlapping dirty paths from warning to blocker with a clear recovery message
- `lib/commands/integrate.ts`: `reportStashPopFailure()` — improve diagnostics for operators
- `test/integrate-task-1410-stash-pop-corruption.test.js`: deterministic reproduction test that fails on current main and passes after the fix
- `lib/core/git.ts`: any supporting git helpers needed for safer stash/restore semantics (e.g., `stash show --name-only` for overlap detection)

## Out of Scope

- Changes to `lib/core/mission-utils.ts` beyond what is needed for the integrate closeout path
- Forgejo/sync-merged logic changes
- Graphify update logic changes
- Changes to the integration gate pipeline system (`config/integration-pipelines.json`, `scripts/verify-local.sh`)
- Changes to the backlog task storage layout or workflow schema
- Manual recovery procedures for already-corrupted checkouts (operators should use existing `git stash drop` guidance)

## Success Criteria

1. **Corruption-free restore**: After any integrate run (Variant A or Variant B), `git -C <primary-worktree> ls-files -u` returns zero files (no unresolved index conflicts) and `git -C <primary-worktree> status --porcelain` shows no deleted tracked files or stray untracked task files that did not exist before the integrate started.

2. **Overlap detection blocks unsafe integrates**: When `printIntegrationPreflight()` detects that the primary checkout has dirty paths overlapping any file in `backlog/tasks/`, `backlog/completed/`, or `missions/<slug>/`, it emits a `FAIL` (not `WARN`) with a recovery message listing the overlapping paths and instructing the operator to commit or discard them before retrying.

3. **Stash restore is collision-safe**: `restoreMainCheckoutStash()` uses `git stash pop --index` or an equivalent safe restore that resolves collisions by preserving the integrate-edited version and marking conflicts for manual resolution, rather than a blind `git stash pop` that overwrites files. On collision, the function returns a non-zero status and `reportStashPopFailure()` prints which files collided and the exact recovery commands.

4. **Operator visibility**: Every dirty-state interaction (block, stash, patch, restore, or collision) is logged with a `[STASH]` or `[RESTORE]` prefix so an operator can tell from the integrate log output whether local edits were blocked, stashed, patched, or restored.

5. **Regression test gates the fix**: The reproduction test in `test/integrate-task-1410-stash-pop-corruption.test.js` fails (exit code non-zero or assertion failure) when run against the unfixed code and passes when run against the fixed code, confirming the bug is locked and the fix resolves it.

## Risks and Assumptions

- **Risk**: Upgrading dirty-state from warning to blocker may cause regressions for operators who routinely work on main while missions integrate. **Mitigation**: the blocker message includes actionable recovery steps and the stash/restore mechanism still works for non-overlapping dirty paths.
- **Risk**: `git stash pop --index` may behave differently across git versions. **Assumption**: the minimum supported git version is 2.40+, which has stable `stash pop --index` semantics.
- **Risk**: The overlap detection adds complexity to the preflight check. **Assumption**: the set of files integrate mutates during closeout is bounded (task files, worktree paths in task YAML, mission docs) and can be enumerated.
- **Assumption**: Existing tests in `test/integrate.test.js` will continue to pass; new behavior may require adjustments to mocks in existing stash/restore tests.

## Checkpoints

- CP 1: Author the reproduction test in `test/integrate-task-1410-stash-pop-corruption.test.js` that simulates a dirty primary checkout with overlapping backlog task edits before integrate runs, verifies the test fails on the parent commit (red), and documents the `Reproduction-Test:` path.
- CP 2: Implement overlap detection in `printIntegrationPreflight()` — when dirty paths overlap backlog/mission files that integrate will mutate, emit FAIL with recovery message.
- CP 3: Harden `restoreMainCheckoutStash()` to use safe restore semantics (`stash pop --index` or patch-based restore) and improve `reportStashPopFailure()` diagnostics.
- CP 4: Update or adjust existing stash/restore tests in `test/integrate.test.js` to accommodate the new behavior.
- CP 5: Run `./scripts/verify-local.sh all` green, confirm the reproduction test transitions red→green, and complete the Goal Check table.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- `config/integration-pipelines.json` — integration gate configuration must not change
- `scripts/verify-local.sh` — verification script must not change
- `lib/tools/backlog.ts` (or `.js`) — backlog tooling internals are out of scope
- `lib/core/mission-utils.ts` — mission utility functions are out of scope except where directly called by integrate closeout
- `prompts/` — prompt templates are out of scope

## Stop Rules

- Stop if the overlap detection logic becomes too broad (blocking integrates for unrelated dirty paths like editor swap files or `.env` changes). Narrow the overlap set to backlog task files, mission docs, and worktree-path references only.
- Stop if the safe restore mechanism requires git features not available in the CI environment. Fall back to a conservative approach: block the integrate entirely when dirty overlap is detected, without attempting stash restore.
- Stop if the reproduction test cannot be made deterministic with mocked git calls. Pivot to an integration-style test using a real temporary git repository in `/tmp`.
- Stop if static analysis (`./scripts/verify-local.sh static-analysis`) fails on the first attempt and cannot be resolved within one iteration of fixes. Escalate for human review.

Reproduction-Test: test/integrate-task-1410-stash-pop-corruption.test.js
