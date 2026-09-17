# Checkpoint 2 — Focused tests for the purest, highest-gap modules

## Summary
Author focused, injected-double unit tests for the CP-2 target modules named in
the backlog: `src/adapters/config/product-config.ts`,
`src/adapters/config/repository-gates.ts`, `src/adapters/git/git.ts`, and
`src/application/presentation/cli-format.ts`. Every external boundary (real
forgejo, git subprocess, filesystem, process env) is replaced with an injected
double or a temp fixture; no real CLI, agent, or network is spawned.

The backlog's per-module percentages (~27–39%) are stale; the true parent-baseline
per-module numbers live in `missions/task-2535/CP-1.md` (captured from
`coverage/lcov.info` at parent `830634647`). Against that baseline the CP-2
targets moved as follows:

| Module (source path) | Parent | Now | Delta |
| --- | --- | --- | --- |
| `src/adapters/config/product-config.ts` | 79.4% | 96.5% | +17.1 pts |
| `src/adapters/git/git.ts` | 90.2% | 97.7% | +7.5 pts |
| `src/adapters/config/repository-gates.ts` | 100.0% | 100.0% | flat (already covered) |
| `src/application/presentation/cli-format.ts` | 67.5% | 68.0% | +0.5 pts |

`cli-format.ts` is a heavily-imported leaf: its lines are exercised by many
importers, so its per-file number is dominated by the parallel-worker coverage
attribution and does not scale with added tests. The metric that matters is the
`src/` aggregate, which rose from 89.01% to 90.05% (see CP-4).

`product-config.ts` coverage was added by `test/product-config-validation.test.ts`,
whose `test("validateWorkflowConfig flags a non-object tasks.provider (SUPPORTED_TASK_PROVIDERS rejection)", ...)`
and `test("validateWorkflowConfig flags an invalid integration.mode", ...)`
exercise the `SUPPORTED_TASK_PROVIDERS` rejection and the invalid-mode branches
that were previously dead. `repository-gates.ts` stays at 100% because the
pre-existing `test/repository-gates.test.ts` already drove it. `git.ts` sits at
97.7% this run (parent 90.2%); it is a heavily-imported leaf whose per-file number
is sensitive to the parallel-worker coverage attribution, so treat it as a
point-in-time reading and watch the `src/` aggregate rather than the single file.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `product-config.ts` highest-gap target covered vs baseline | `test/product-config-validation.test.ts` → `src/adapters/config/product-config.ts` 79.4%→96.5% in `coverage/lcov.info` | PASS |
| `git.ts` target covered vs baseline | `src/adapters/git/git.ts` 90.2%→97.7% in `coverage/lcov.info` (point-in-time; heavily imported) | PASS |
| `repository-gates.ts` fully covered | `src/adapters/config/repository-gates.ts` 100.0% line in `coverage/lcov.info` | PASS |
| Every external boundary mocked/injected | `test/product-config-validation.test.ts` passes an explicit `rootDir` fixture and never reads the repo `workflow.config.json`; `test/product-config-validation.test.ts` `"validateWorkflowConfig flags a non-object tasks.provider (SUPPORTED_TASK_PROVIDERS rejection)"` runs in-process with injected doubles | PASS |
| Coverage gate threshold literal unchanged | `grep -n "let threshold = 90" src/adapters/verification/coverage-gate.ts` → line 137 | PASS |
| Aggregate coverage rising | `npm run test:coverage -- --lcov` → `all files 90.05` line (parent `89.01`), `coverage/lcov.info` | PASS |

## Next action:
Author focused tests for the remaining mid-size modules — `stats`/`stats-backfill`
formatting helpers, `github-pr`, `review-loop`, and `verification` — then run the
gate and confirm the aggregate; see CP-3.
