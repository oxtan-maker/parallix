# Checkpoint 4 — Final: gate green, success criteria met

## Work done

Implemented the shared base-branch correction, added red-to-green regression and
flow-preservation coverage, and ran the required gate.

- **Root cause / fix** (`src/adapters/cli/commands/draft-setup.ts`,
  `ensureMissionBaseBranchRecorded`): the writer treated a falsy `baseBranch`
  (primary / detached-HEAD launch) as an unconditional no-op, so a stale
  `Base-Branch` from a prior feature-branch re-draft survived and
  `resolveMissionBaseBranch` resolved a branch that no longer exists (task-2389,
  `friday-08-21`). The fix removes a stale `Base-Branch:` line when the current
  launch base is primary/detached, so the resolver falls back to the primary
  branch. It is the single writer all draft-startup callers route through
  (`draft-stats.ts` scaffold + post-process), so the change is one guard with no
  per-caller duplication and no change to the non-primary replace path.
- **Regression**: `test/draft.test.ts`, `"runDraftCommand clears a stale feature
  Base-Branch when re-drafted from the primary branch"`.
- **Non-primary re-draft**: `test/draft.test.ts`, `"runDraftCommand records a
  non-primary launch branch over a previous base on re-draft"`.
- **Flow preservation** (new-mission creation + worktree reuse):
  `test/draft.test.ts`, `"ensureMissionBranch creates branch from main when absent"`,
  `"ensureMissionBranch skips creation when branch already exists"`, and
  `"runDraftCommand reuses the existing mission branch and clears the stale base on a primary re-draft"`.
- **Writer unit coverage**: `test/draft.test.ts`, `"ensureMissionBaseBranchRecorded clears a stale Base-Branch line on a primary/detached launch"`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Re-draft from `main` removes stale feature `Base-Branch`; resolved base is `main` before backlog transition | `test/draft.test.ts`, `"runDraftCommand clears a stale feature Base-Branch when re-drafted from the primary branch"` (green); fix in `src/adapters/cli/commands/draft-setup.ts` | PASS |
| Re-draft from non-primary records launch branch, replacing prior base | `test/draft.test.ts`, `"runDraftCommand records a non-primary launch branch over a previous base on re-draft"` (green) | PASS |
| Regression RED at parent commit, GREEN after fix | committed baseline `3d683bf58` → `✖ clears a stale feature Base-Branch`; after fix `cc10cbf21` → `✔ clears a stale feature Base-Branch`; command `npx tsx test/run-default-tests.ts test/draft.test.ts` | PASS |
| New-mission creation + worktree reuse retain prior behavior apart from corrected base | `test/draft.test.ts`, `"ensureMissionBranch creates branch from main when absent"`, `"ensureMissionBranch skips creation when branch already exists"`, `"runDraftCommand reuses the existing mission branch and clears the stale base on a primary re-draft"` | PASS |
| `./scripts/verify-local.sh all` completes successfully | `./scripts/verify-local.sh all` → verify-docs PASS; 2076 tests, 0 fail (final tree) | PASS |

Green command (final tree): `npx tsx test/run-default-tests.ts test/draft.test.ts`
→ 73 pass, 0 fail. Full gate: `./scripts/verify-local.sh all` → 2076 pass, 0 fail.

## History
- `3d683bf58` test(task-2396): add red regression for stale base-branch on primary re-draft (CP-1)
- `cc10cbf21` fix(task-2396): clear stale base-branch on primary re-draft (CP-2)
- `2386109b7` test(task-2396): cover reuse/non-primary re-draft base correction (CP-3)

Next action: Submit the corrected checkpoint evidence for review; no migration of historical missions is required by the Stop Rule.
