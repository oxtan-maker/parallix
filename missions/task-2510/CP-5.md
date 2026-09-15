# CP-5: One Commit per Mission

## Summary

Previously every integration produced two commits on the base branch: the
mission squash commit and a `chore: bump version` commit created afterwards by
the post-integrate hook. Integrating task-2500.05 also moved the version
backwards from 1.5.121 to 1.5.119. That mission branch carried a stale
`package.json`, and the hook bumped the stale value.

Amending the landed commit is unsafe. Forgejo sync-merged, mission closeout, and
github-publish all bind to the landed commit SHA immediately after it is
created. The bump therefore now happens before landing:

- `px integrate` runs an optional `adapters.integrate.preCommitCommand` in the
  mission worktree right after the integration rebase and before the
  integration gates. It commits the tracked files the hook modifies onto the
  mission branch. The gates verify the bumped tree, and the squash lands it in
  the single mission commit. Dry runs do not run the hook, and a failing hook
  aborts before any gate runs.
- Parallix wires `scripts/bump-version.sh` as that hook. The next version is the
  base branch version plus one patch, unless the mission already declares a
  newer version. This makes the script idempotent across integrate retries and
  prevents the version from moving backwards.
- `scripts/refresh-global-px.sh` (post-integrate) now only builds, packs, and
  installs. It no longer bumps or commits.
- The configuration schema, config validation, `docs/config.md`, and ADR 0046
  procedure 2 describe the new hook.

This implementation landed on `main` through task-2509, which reused it
unchanged (task-2509 CP-7). After rebasing onto `main`, this mission carries no
code for this checkpoint: the hook, schema, config validation, and scripts come
from task-2509, and task-2509's wording of ADR 0046, `refresh-global-px.sh`, and
its test supersedes this mission's. The evidence below cites the tests as they
exist on `main`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mission lands as one commit carrying the version change | `test/e2e-mission-lifecycle.test.ts` "pre-commit hook changes land inside the mission squash commit, not a follow-up commit (task-2510)"; `test/task-2509-local-version-allocation.test.ts` "task-2509: local allocation lands matching package metadata in the one mission commit" | PASS |
| Hook changes are committed onto the rebased mission branch, nothing else | `test/integrate.test.ts` "runPreCommitHookOrAbort commits only the tracked files the hook modified onto the mission branch (task-2510)", "runPreCommitHookOrAbort creates no commit when the hook changes nothing (task-2510)" | PASS |
| Failing hook aborts before gates | `test/integrate.test.ts` "runPreCommitHookOrAbort aborts before the integration gates when the hook fails (task-2510)" | PASS |
| Version never moves backwards (task-2500.05 regression) | `test/task-2509-local-version-allocation.test.ts` "task-2509: local allocation never moves a stale mission version backwards" | PASS |
| Retried integration keeps an allocated newer version | `test/task-2509-local-version-allocation.test.ts` "task-2509: local allocation keeps a newer version already allocated by a retried integration" | PASS |
| Post-integrate hook no longer bumps or commits | `test/refresh-global-px-script.test.ts` "scripts/refresh-global-px.sh rebuilds and reinstalls from a packed tarball without allocating a version" | PASS |
| Existing post-integrate hook behavior unchanged | `test/e2e-mission-lifecycle.test.ts` SC1–SC4 hook tests | PASS |
| Static analysis and docs gates clean | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh docs` | PASS |
| Mission gate green | `./scripts/verify-local.sh all` | PASS |

## Next action
Integrate this mission with `px integrate task-2510`. The pre-commit hook is
already on `main` through task-2509, so this integration should land exactly
one `mission/task-2510` commit whose `package.json` is one patch above `main`.
