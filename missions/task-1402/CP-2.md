# CP-2: Wire the hook into the successful integrate paths

## Summary of work done

- Imported the new hook module into `lib/commands/integrate.ts:15` (`import * as postIntegrateHook from '../core/post-integrate-hook.js';`).
- Added `runPostIntegrateHookOrAbort(slug, { baseWorktree, baseBranch, variant, runPostIntegrateHookFn })` in `lib/commands/integrate.ts` (helper adjacent to `recordPostIntegrationStatsOrAbort`). It resolves the hook via `postIntegrateHook.runPostIntegrateHook`, is a silent no-op when unconfigured, logs a `[PASS]` line and hook output on success, and on failure logs `[FAIL] Post-integrate hook failed (exit code N): <command>` plus captured output and throws `IntegrationAbort` (so the outer `try/catch` sets `exitCode = 1` and the normal success message is never reached).
- Wired exactly one call site per success branch, each placed after worktree cleanup/graphify update and before the branch's final `fmt.log.pass(...)` success line, so a hook failure suppresses that success message:
  - Variant A closeout success — call site right before `fmt.log.pass('Variant A integration completed.')`.
  - Variant B resumed-from-existing-squash-commit success — call site right before `fmt.log.pass('Integration completed successfully (resumed from partial state).')`.
  - Variant B fresh squash-merge success — call site right before `fmt.log.pass('Integration completed successfully.')`.
- Each branch is mutually exclusive within a single `integrate` invocation (Variant A vs. Variant B-fresh vs. Variant B-resumed are alternate control-flow paths, never sequential), so each success path invokes the hook at most once per `px integrate` run by construction — no shared invocation counter is needed.
- Exported `runPostIntegrateHookOrAbort` from `lib/commands/integrate.ts` (default-export property, `IntegrateFn` interface member, and named export) so it is independently testable.

## Goal Check

| Success criterion | Evidence |
| --- | --- |
| SC2: successful Variant A integrate invokes the hook exactly once from the base checkout, with slug/base-worktree/base-branch/variant env vars | Call site: Variant A closeout success branch in `lib/commands/integrate.ts` (`runPostIntegrateHookOrAbort(slug, { baseWorktree, baseBranch, variant: 'variant-a' })` immediately before `fmt.log.pass('Variant A integration completed.')`); env-var contract proven by test `buildPostIntegrateHookEnv exposes slug, base worktree, base branch, and variant` in `test/post-integrate-hook.test.js:47-59`; invocation semantics proven by `runPostIntegrateHookOrAbort passes slug, base worktree/branch, and variant to the hook (SC2/SC3)` in `test/integrate.test.js` |
| SC3: successful Variant B (fresh and resumed) invokes the hook exactly once, no double-run | Call sites: Variant B fresh-squash success branch (`variant: 'variant-b'`) and Variant B resumed-from-squash-commit success branch (`variant: 'variant-b-resumed'`) in `lib/commands/integrate.ts`, each the sole terminal seam of its mutually-exclusive branch; real end-to-end proof in `test/e2e-mission-lifecycle.test.js` test `configured post-integrate hook runs exactly once with slug/base-worktree/base-branch/variant env vars (SC2/SC3)` — asserts `postIntegrateHookLines.length === 1` and the line matches `slug=task-2002 base_worktree=\S+ base_branch=main variant=variant-b` after a real subprocess `px integrate` run against a real temp git repo |
| SC1: repos with no hook configured see no behavior change | `test/e2e-mission-lifecycle.test.js` test `a repo with no post-integrate hook configured runs px integrate with unchanged behavior (SC1)` — real `px integrate` run with no `adapters.integrate` configured completes with `rootTaskStatus === 'done'` and no hook marker file is ever created |
| Hook runs from the base checkout, not the mission worktree | `runPostIntegrateHook` in `lib/core/post-integrate-hook.ts:56-65` sets `cwd: params.baseWorktree`; e2e test's hook script reads `$INTEGRATE_HOOK_BASE_WORKTREE` and the captured line shows a `base_worktree=` path distinct from the (now-deleted) mission worktree |

Test runs:
- `FORCE_COLOR=0 node --test test/integrate.test.js` — 59 passed, 0 failed (includes new `runPostIntegrateHookOrAbort` wiring tests).
- `FORCE_COLOR=0 node --test test/e2e-mission-lifecycle.test.js` — 5 passed, 0 failed (includes the two new post-integrate-hook e2e scenarios), ~25s total.

Next action: Add the remaining focused regression coverage proving the hook is skipped on `--dry-run`, preflight failure, integration-gate failure, and closeout/merge failure, and that a hook failure is reported as a distinct post-integrate-hook failure (CP3).
