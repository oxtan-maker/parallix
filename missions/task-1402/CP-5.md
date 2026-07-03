# CP-5: Operator-facing docs and verification gates

## Summary of work done

- Documented the generic post-integrate hook and the parallix-specific self-update behavior in `docs/authority-reference.md`:
  - New `#### 4.5.2 Post-integrate hook (generic, repo-configurable)` subsection: the `adapters.integrate.postIntegrateCommand` config knob, the no-op default, exactly when it runs (after which success shapes, never on dry-run/preflight/gate/closeout failure), where it runs from (base checkout, not the mission worktree), the four `INTEGRATE_HOOK_*` environment variables in a table, and the distinct-failure/no-rollback behavior.
  - Same subsection documents parallix's own wiring: `workflow.config.json` → `./scripts/refresh-global-px.sh` → patch bump, rebuild, pack, global reinstall — explicitly framed as automating the "bump before integrate, reinstall after" discipline.
  - Updated the pre-existing "Public distribution" section (`docs/authority-reference.md:342-348`) so it no longer describes the patch-bump/reinstall discipline as purely a manual, undocumented-in-code practice; it now cross-references §4.5.2 and states plainly that this repo automates it via the hook.
- Checked off the completed Definition of Done items on the backlog task (`backlog/tasks/task-1402 - ensure-px-is-updated-as-global-runner.md`) without touching the `assignee` field; DoD #6 (bug red-to-green reproduction) is marked not-applicable since this task is not bug-labeled.
- Ran both mission-declared gates on the final tree.

## Verification gate proof

- `./scripts/verify-local.sh static-analysis` — ESLint clean, `tsc` typecheck clean, test-hygiene clean. Exit: `=== Static Analysis Gate: ALL STAGES PASSED ===`.
- `./scripts/verify-local.sh all` (→ `npm test`, `FORCE_COLOR=0 node --test test/*.test.js`) — `ℹ tests 1902`, `ℹ pass 1880`, `ℹ fail 0`, `ℹ skipped 22` (pre-existing skips unrelated to this mission — none are new `.only`/bare `.skip`; confirmed via `grep -rn "\.only(\|\.skip(" test/post-integrate-hook.test.js test/refresh-global-px-script.test.js test/integrate.test.js test/product-config.test.js test/e2e-mission-lifecycle.test.js` returning no matches).
- `git diff package.json package-lock.json` is empty — confirms local manual `npm pack`/`npm run build:cjs` runs used to verify hook-script behavior during CP4 did not leave stray version bumps in the tree.

## Goal Check

| Goal Check | Evidence | Status |
| --- | --- | --- |
| SC1: post-integrate command is optional; no-hook repos are unchanged | `lib/core/product-config.ts:8-24` (`integrate: {}` default); `config/workflow.config.schema.json:64-80`; test `loadEffectiveConfig has no post-integrate hook by default` (`test/product-config.test.js`); e2e test `a repo with no post-integrate hook configured runs px integrate with unchanged behavior (SC1)` (`test/e2e-mission-lifecycle.test.js`) | PASS |
| SC2: successful Variant A invokes the hook exactly once from the base checkout with slug/base-worktree/base-branch/variant | Call site `lib/commands/integrate.ts:678`; env-var contract `lib/core/post-integrate-hook.ts:34-40`; unit test `runPostIntegrateHookOrAbort passes slug, base worktree/branch, and variant to the hook (SC2/SC3)` (`test/integrate.test.js`) | PASS |
| SC3: successful Variant B (fresh + resumed) invokes the hook exactly once, no double-run | Call sites `lib/commands/integrate.ts:722` (resumed) and `:844` (fresh); real subprocess proof: e2e test `configured post-integrate hook runs exactly once with slug/base-worktree/base-branch/variant env vars (SC2/SC3)` (`test/e2e-mission-lifecycle.test.js`) — asserts exactly one marker line matching `slug=task-2002 base_worktree=\S+ base_branch=main variant=variant-b` after a real `px integrate` run | PASS |
| SC4: hook never runs on `--dry-run`, preflight failure, gate failure, or closeout/merge failure | `px integrate --dry-run never invokes the post-integrate hook (SC4)` and `px integrate never invokes the post-integrate hook when preflight fails (SC4)` (`test/integrate.test.js`, real `integrate()` invocation + `mock.method` spy, 0 calls); e2e test `a failed integration gate aborts before the post-integrate hook can run (SC4)` (`test/e2e-mission-lifecycle.test.js`, real subprocess, non-zero exit, empty hook marker); closeout/merge-failure guards structurally precede every hook call site (`lib/commands/integrate.ts:658,674,706,718,757,793,806,813,826` all `throw`/abort before `:678`, `:722`, `:844`) | PASS |
| SC5: hook failure is a distinct post-integrate-hook failure with captured output, no success message | `runPostIntegrateHookOrAbort throws IntegrationAbort and surfaces a distinct failure with hook output (SC5)` (`test/integrate.test.js`) — asserts exact `[FAIL] Post-integrate hook failed (exit code 3): ./scripts/refresh-px.sh` plus captured output; call-site placement in `lib/commands/integrate.ts:678,722,844` is immediately before each branch's terminal `fmt.log.pass('...completed...')` line | PASS |
| SC6: parallix wires the hook to a checked-in `scripts/` script that bumps patch version and refreshes the global `px` install | `scripts/refresh-global-px.sh` (executable, checked in); `workflow.config.json:16` (`adapters.integrate.postIntegrateCommand`); tests in `test/refresh-global-px-script.test.js` (config wiring, executability, `bash -n` syntax check, source references `npm version patch`/`npm run build:cjs`/`npm pack`/`npm install -g`) | PASS |
| SC7: repo-specific hook behavior documented for operators (generic knob + parallix self-update) | `docs/authority-reference.md` §4.5.2 (new); Public-distribution cross-reference update at `docs/authority-reference.md:342-348` | PASS |
| SC8: `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` both pass on the final tree | See "Verification gate proof" above — static-analysis all stages passed; `all` → 1880/1902 passing, 0 failing, 22 pre-existing unrelated skips, no new `.only`/bare `.skip` | PASS |

## Gates

- [x] `./scripts/verify-local.sh static-analysis`
- [x] `./scripts/verify-local.sh all`

Next action: Hand off task-1402 for review — all five checkpoints are complete, both mission gates pass, and the backlog task's Definition of Done items are checked off except the not-applicable bug-repro item.
