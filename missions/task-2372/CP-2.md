# CP-2: Delete the duplicate integrate-command module

## Summary

Deleted `src/adapters/cli/commands/integrate-command.ts` (1156 lines, the inactive
diverging copy of the integration orchestration). No other `src/` file was touched:
`src/adapters/cli/commands/integrate.ts` remains the single canonical implementation
with its default export, CJS property attachments, and full re-export surface intact.

`git status --short` after the deletion shows exactly one `src/` entry, and it is a
deletion:

```
 D src/adapters/cli/commands/integrate-command.ts
 M test/forgejo-independence.test.ts
 M test/task-2203-publish-proof-refresh-order.test.ts
 M test/task-2204-integrate-no-variant-a.test.ts
 M test/task-2242-backlog-drift.test.ts
```

(` M package-lock.json` is the pre-existing baseline modification recorded in CP-0,
not mission work.)

### Test command

```
FORCE_COLOR=0 node --import tsx --import ./test/bootstrap-parallix-home.ts \
  --experimental-test-module-mocks --test-force-exit --test-timeout=30000 --test \
  test/task-2203-publish-proof-refresh-order.test.ts test/forgejo-independence.test.ts \
  test/task-2204-integrate-no-variant-a.test.ts test/task-2242-backlog-drift.test.ts \
  test/task-2369-regressions.test.ts test/integrate.test.ts
```

Result: `tests 121 / pass 121 / fail 0`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 (duplicate module absent) | Parent SHA `c51cc7d70f000b1d18342a44eee4d437ef64f390`; `git diff --name-only --diff-filter=D c51cc7d70f000b1d18342a44eee4d437ef64f390` lists `src/adapters/cli/commands/integrate-command.ts` | Done |
| SC2 (canonical export surface untouched) | `src/adapters/cli/commands/integrate.ts` is absent from `git diff --name-only c51cc7d70f000b1d18342a44eee4d437ef64f390 -- src/`; `grep -n "^export" src/adapters/cli/commands/integrate.ts` still shows `export default integrate` plus the CP-0 named/re-export list (`resolveConflictsForMission` via `./integrate-conflict.js`, `runPostIntegrateHookOrAbort` via `./integrate-post.js`) | Done |
| SC4 (retargeted tests still pass post-deletion) | `test/task-2203-publish-proof-refresh-order.test.ts` (`Variant B: post-integrate hook runs before proof capture (task-2203 fix)`), `test/forgejo-independence.test.ts` (`integrate gates syncMerged behind isForgejoReviewEnabled`, `integrate printIntegrationPreflight gates Forgejo checks`), `test/task-2204-integrate-no-variant-a.test.ts`, `test/task-2242-backlog-drift.test.ts` — all `✔` in the 121-test run | Done |
| SC5 (lifecycle regressions incl. review-origin approval and failed landing) | `test/task-2369-regressions.test.ts`: `R1: backlog promotion cannot complete the Mission when landing fails`, `R2: an approved normal integration completes exactly once and a retry stays at one`, `R3: a review-origin integration completes only after the commit has landed`, `R4: a resumed integration is stamped with the landed commit time, not the retry time` all `✔`; `test/integrate.test.ts` passes in the same run | Done |
| SC7 (deletion is the only `src/` change) | `git diff --name-only --diff-filter=M c51cc7d70f000b1d18342a44eee4d437ef64f390 -- src/` prints nothing | Done |
| Stop rule 3 (R1–R4 / `test/integrate.test.ts` must stay green after deletion) | `pass 121 / fail 0` in the run above | Not triggered |

Next action: CP 3 — run the module-precise SC1 sweep `git grep -nE "integrate-command\.(ts|js)" -- src test scripts workflow.config.json package.json`, confirm SC3 with `git diff --name-only <parent> -- src/composition/create-cli.ts src/interfaces/cli/integrate.ts src/application/integrate-command-use-case.ts src/adapters/rebase/rebase-workflow-adapter.ts`, then run the declared gates `git diff --check` and `./scripts/verify-local.sh all`.
