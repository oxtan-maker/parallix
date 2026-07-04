# Mission: Suppress noisy main-worktree inspection warnings in non-repo contexts (task-1411)

## Goal

Stop emitting the recurring warning
`Could not inspect git worktrees while looking for main-worktree agents.local.json; skipping that lookup (git exited with status 128).`
when agent config loading runs in a directory that is not a Git worktree and the lookup is already being skipped safely.

## Why Now

The backlog task for `TASK-1411` contains one concrete failure report: a user repeatedly sees this warning during normal workflow use. In the current code, `readAgentConfig()` calls `getMainWorktreePath()` when local agent config merging is enabled, and `getMainWorktreePath()` currently warns on a non-zero exit from `git worktree list --porcelain`.

That warning is user-visible noise unless the failure indicates a real defect. A directory not attached to a Git worktree is an expected environment for some calls, and the code already tolerates it by continuing without a main-worktree `agents.local.json` merge. The mission is to remove the false-positive warning without weakening diagnostics for genuinely unexpected failures.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: user-visible warning spam, narrow code path, existing targeted test coverage

## Scope

- Adjust the main-worktree lookup behavior used by `readAgentConfig()` so expected non-repo failures from `git worktree list --porcelain` do not produce a warning.
- Keep `readAgentConfig()` behavior unchanged apart from warning suppression for that expected case: it must still return usable config data and still skip the main-worktree local-config merge when no main worktree can be determined.
- Update existing tests in `test/agents.test.js` to match the corrected behavior.
- Add focused regression coverage only if the existing test surface is not sufficient to prove the behavior change cleanly.

## Out of Scope

- Changing agent selection rules, blocklist merge precedence, or local-config schema.
- Reworking `MainWorktreeDetector`, cache strategy, or broader Git path resolution behavior beyond what is needed for this warning fix.
- Changing unrelated warning paths for malformed local config, invalid JSON, or unexpected subprocess exceptions.
- General cleanup or refactoring outside the affected agent-config lookup path.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC 1: Calling `readAgentConfig(..., { mergeLocal: true, warn })` from a temp directory that is not a Git worktree completes successfully and records zero warnings for the expected `git worktree list --porcelain` non-repo failure path.
- SC 2: The existing regression test in `test/agents.test.js` that currently expects a warning for failed main-worktree inspection is updated to assert the corrected no-warning behavior, or an equivalent focused test proves the same behavior.
- SC 3: Diagnostics remain for unexpected lookup failures: code paths that use the `catch`-based warning behavior still warn when the lookup fails for reasons other than the expected non-repo Git exit.
- SC 4: Existing local-config merge behavior still works when a valid main worktree path is supplied explicitly or can be determined successfully.
- SC 5: The required integration gate for `lib/` changes passes: `./scripts/verify-local.sh static-analysis`.

## Risks and Assumptions

- Risk: suppressing the warning too broadly could hide legitimate Git invocation failures. Mitigation: narrow the suppression to the expected non-repo failure mode rather than removing diagnostics wholesale.
- Risk: the repository tracks both TypeScript sources and generated JavaScript, so the implementation may require parallel updates in `lib/agents/agents.ts` and `lib/agents/agents.js`. Mitigation: verify the tracked source-of-truth pattern in the touched area and keep the pair aligned if required by the repo.
- Assumption: the current warning observed in `TASK-1411` comes from the `readAgentConfig()` to `getMainWorktreePath()` path already covered by `test/agents.test.js`.
- Assumption: a focused unit-level regression is sufficient proof; no end-to-end workflow reproduction is required unless the unit tests cannot isolate the warning path reliably.

## Checkpoints

- CP 1: Confirm the reported warning path in code and tests, and identify the exact condition that should be treated as expected rather than warn-worthy.
- CP 2: Implement the warning-suppression change in the agent-config worktree lookup path without changing unrelated behavior.
- CP 3: Update or add focused regression coverage proving the warning no longer appears for the expected non-repo case.
- CP 4: Run the required verification gate and capture proof for the final checkpoint.

## Gates

- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas

- `lib/agents/agents.ts` and any tracked compiled counterpart only as needed for the warning behavior change.
- `test/agents.test.js` and any focused regression test added for this mission.
- Mission and checkpoint artifacts under `missions/task-1411/`.

## Stop Rules

- Stop if fixing the warning requires changing behavior outside agent-config main-worktree lookup or broadening scope into unrelated Git/worktree architecture.
- Stop if the observed warning cannot be reproduced from the current `readAgentConfig()` path and the backlog report points to a different caller or subsystem.
- Stop if the required static-analysis gate fails for unrelated pre-existing issues that cannot be cleanly separated from this mission's change.
