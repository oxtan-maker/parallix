# Checkpoint 3 — Reuse the rebase workflow in `px integrate` + mission gate

## Summary of work done
The integration-time rebase was already implemented in
`src/adapters/cli/commands/integrate.ts` (committed as `ca1b77b3e`, captured by
the execute safety harness), then hardened against the round-1 review findings
(F1–F4, see below):

- `runIntegrationRebase` (lines 60–128) delegates to the shared
  `runRebaseWorkflow` from `src/application/rebase-workflow.ts` through
  `createRebaseWorkflowPort` (`src/adapters/rebase/rebase-workflow-adapter.ts`),
  with an exit-capturing seam (`exitFn`) so a clean rebase lets integrate
  continue past it instead of terminating. The root/branch/target seams are
  pinned to the ADR 0043 target integrate already resolved
  (`port.resolveMissionBaseBranch`, `port.getCurrentBranch`, `port.cwd`).
- `predictIntegrationRebase` (lines 130–167) is the non-mutating dry-run path:
  it resolves the same ADR 0043 target and runs a virtual 3-way
  `git merge-tree --write-tree` to detect a would-be conflict, never touching
  HEAD.
- Both are invoked from the preflight→gate→probe-merge sequence at
  `integrate.ts:482–496`: dry-run reports need/conflict and leaves HEAD
  unchanged; the real run calls `runIntegrationRebase` **before** the
  `run-required-local-gates` boundary and before the probe merge.

### Review round 1 (claude → custom, request-changes) — fixed
All four findings were correctness/evidence defects in this mission's diff; none
were rebasing artifacts or out-of-scope. Every fix is covered by the
`test/task-2506-integrate-rebase.test.ts` + `test/task-2506-dry-run-rebase.test.ts`
regressions and the mission gate (`./scripts/verify-local.sh all`,
2588 pass / 0 fail; static-analysis gate clean).

- F1 (`runIntegrationRebase` treated every exit code except 1 as success): the
  workflow also exits 0 with a rebase still in progress and leaves the hook
  failure stranded without calling `port.exit`. Now the run dead-ends on any
  non-zero exit code and additionally confirms completion with
  `git rebase --show-current` empty and a `git merge-base --is-ancestor` base
  ancestry check (`integrate.ts:100–128`) before announcing success. The base
  ancestry uses the same `--is-ancestor` idiom the workflow's own
  `verifyBaseAncestry` gates on.
- F2 (port received the resolved services object instead of the factory):
  `runIntegrationRebase` is now called with the `missionServicesFn` factory
  (`integrate.ts:496`), not the resolved `missionServices` object, so
  `createRebaseWorkflowPort` installs the rebound hook-failure path and the
  mission's agent-assisted conflict path survives.
- F3 (gate-ordering criterion recorded as Proven by a test that disabled
  gates): `test/task-2506-integrate-rebase.test.ts` now configures a real
  `adapters.gates.preIntegration` command and asserts it ran against the
  rebased branch (the `--no-integration-gates` bypass was removed).
- F4 (dry-run evidence overstated + conflict guidance named a rebase that was
  never started): `test/task-2506-dry-run-rebase.test.ts` asserts the
  `integrate --dry-run` branch reports a needed rebase and issues no mutating
  git call; the would-conflict guidance no longer suggests
  `git rebase --abort` (which fails with `No rebase in progress`).

Regression coverage (CP-2) plus a regression fix to a test heuristic broken by
the new path:

- `test/task-2506-integrate-rebase.test.ts` and
  `test/task-2506-dry-run-rebase.test.ts` — red→green integration regressions.
- `test/task-2500-integrate-mode-dispatch.test.ts` — the new rebase path issues
  a `merge-base --is-ancestor` probe (and a `merge.autoedit=no` rebase config)
  on every run. The test's `gitMerged` heuristic matched any git call
  containing the substring `merge`, so github-pr mode falsely reported a local
  merge. Tightened to detect the `merge` subcommand as a standalone token
  (`c.includes('merge')` on the args array), which is the exact shape of the
  real local merge at `integrate.ts:651/705/789` (`['-C', baseWorktree,
  'merge', '--no-commit'|'--squash', ...]`) and does not match `merge-base` or
  `merge.autoedit=no`.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| `px integrate` resolves same ADR 0043 target and rebases before gates + probe merge | `integrate.ts:482–496` calls `predictIntegrationRebase`/`runIntegrationRebase`; `runIntegrationRebase` calls `runRebaseWorkflow` via `createRebaseWorkflowPort`; `port.resolveMissionBaseBranch = () => baseBranch` (same resolver as `px rebase`) | Proven |
| Integration-time rebase completes before gates (F1) | `integrate.ts:100–128` dead-ends on any non-zero exit and confirms `rebase --show-current` empty + `git merge-base --is-ancestor` base ancestry before announcing success | Proven (round-1 fix) |
| Rebase port receives the factory, not the resolved object (F2) | `integrate.ts:496` passes `missionServicesFn`; `test/task-2506-integrate-rebase.test.ts` exercises the agent-assisted conflict path | Proven (round-1 fix) |
| Clean rebase → no manual rebase, mission identity retained | `test/task-2506-integrate-rebase.test.ts` (mission lands to `done`, no `Rebase the mission branch before integrating` instruction) | Proven |
| Gates execute against rebased branch (behind-primary, conflict-free) | `test/task-2506-integrate-rebase.test.ts` (non-backlog `src/app.ts` ahead commit clears the probe-merge conflict only after rebase) | Proven (red→green) |
| Integration-time rebase conflict → agent-assisted conflict path | `runIntegrationRebase` reuses `runRebaseWorkflow` → `buildRebasePrompt` (`rebase-workflow.ts:144`) + rebound kernel; `test/rebase-use-case.test.ts` `launches an agent for shared-file conflicts` unchanged | Proven |
| `--dry-run` reports needed/conflict and leaves HEAD unchanged | `integrate.ts:484–492` + `test/task-2506-dry-run-rebase.test.ts` asserts the `integrate --dry-run` branch reports a needed rebase and issues no mutating git call; would-conflict guidance no longer names `git rebase --abort` (F4) | Proven (round-1 fix) |
| Regression coverage proves behind-primary conflict-free integrates | `test/task-2506-integrate-rebase.test.ts` in `test/integrate.test.ts` suite (84 tests) + `test/task-2500-integrate-mode-dispatch.test.ts` | Proven |
| `./scripts/verify-local.sh all` succeeds | gate EXIT=0; `npm test` → 2588 pass / 0 fail; static-analysis gate clean | Proven |

## Next action
Mission complete: CP-1, CP-2, CP-3 committed, round-1 review findings (F1–F4)
fixed and committed, and `./scripts/verify-local.sh all` passes (2588 pass /
0 fail) with a clean static-analysis gate. No remaining declared checkpoints or
gates.
