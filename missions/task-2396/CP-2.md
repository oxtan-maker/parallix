# Checkpoint 2 — Shared base-branch writer clears a stale base on primary re-draft

## Work done

Traced every caller of the draft-startup base-state writer and resolver:

- **Writer** `ensureMissionBaseBranchRecorded` (`src/adapters/cli/commands/draft-setup.ts`)
  is the single choke point. It is invoked only from
  `src/adapters/cli/commands/draft-stats.ts`: the **scaffold** step
  (`ensureMissionBaseBranchRecordedFn(missionFile, ctx.recordedBase)`) and the
  **post-process** step (`ensureMissionBaseBranchRecordedFn(ctx.missionFile,
  ctx.recordedBase)`). Both pass `ctx.recordedBase`, which the pre-flight sets to
  `null` for a primary / `main` launch and to the feature branch otherwise.
- **Resolver** `resolveMissionBaseBranch` (`src/adapters/git/worktree.ts`) reads
  the on-disk `Base-Branch:` line and falls back to `getPrimaryBranch()` when
  absent. Its callers (`integrate.ts`, `integrate-conflict.ts`,
  `forgejo-pr.ts`, `rebase-workflow-adapter.ts`, `task-transitions.ts`,
  `redgreen.ts`) all consume the value downstream of draft startup, so clearing
  the stale line at the writer precedes every consumer.

**Root cause:** the writer treated a falsy `baseBranch` as an unconditional
no-op, so re-drafting from `main` left a prior feature-branch `Base-Branch`
intact; the resolver then resolved a branch that no longer exists
(task-2389, `friday-08-21`).

**Smallest shared change:** in `ensureMissionBaseBranchRecorded`, when
`baseBranch` is falsy (primary / detached-HEAD launch) and a stale
`Base-Branch:` line exists, remove that line and return `true`; otherwise keep
the prior no-op. Non-primary launches still take the existing in-place-replace
path, so that behavior is unchanged. This is one function, one guard, applied at
the single writer all callers route through — no per-caller guards.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px draft` from `main` clears stale feature `Base-Branch` before `resolveMissionBaseBranch` is used; resolved base is `main` | `test/draft.test.ts`, `"runDraftCommand clears a stale feature Base-Branch when re-drafted from the primary branch"` | PASS (green) |
| Focused writer-level coverage of the clear-on-stale path | `test/draft.test.ts`, `"ensureMissionBaseBranchRecorded clears a stale Base-Branch line on a primary/detached launch"` | PASS (green) |
| Non-primary re-draft still records the new launch branch, replacing the prior value | `test/draft.test.ts`, `"runDraftCommand records a non-primary launch branch over a previous base on re-draft"` | PASS (green) |
| Existing writer unit tests still pass (no-op when no base line; in-place replace) | `test/draft.test.ts`, `"ensureMissionBaseBranchRecorded is a no-op..."` and `"ensureMissionBaseBranchRecorded replaces a stale Base-Branch line in place"` | PASS (green) |
| Regression is RED at the committed baseline without the fix | committed tree `3d683bf58` (draft-setup.ts at HEAD), `npx tsx test/run-default-tests.ts test/draft.test.ts` → `✖ clears a stale feature Base-Branch` | PASS (red reproduced) |

Green command: `npx tsx test/run-default-tests.ts test/draft.test.ts`
(node 22, `--experimental-test-module-mocks`).

Next action: Verify new-mission creation and existing-mission worktree reuse retain their prior draft behavior (CP-3), then run the required gate and write the final checkpoint (CP-4).
