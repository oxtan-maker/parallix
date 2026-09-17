# CP-3: CI guard and final verification

## Summary

Changed files and why:

- `test/task-2534-backlog-repo-state.test.ts` (new) — unit-tier guard that reads the
  real checkout (`path.resolve(import.meta.dirname, '..')`) with no git calls and
  asserts `checkBacklogIntegrity(repoRoot).filter(i => i.type === 'duplicate-completed')`
  is empty. This is the CI guard AC #4 asks for.
- `test/default-test-suite.test.ts` — **written reason (SC8)**: `expectedIntegrationFiles`
  in this file is a second, order-sensitive inventory of the integration suite, and the
  test `default test runner routes every moved group to integration and excludes it from
  default` fails for any integration test missing from it. Added the new
  `task-2534-stale-backlog-copy-landing-repro.test.ts` entry. (An earlier CP-3 slice
  also added the then-missing `task-2533-squash-payload-pathspec-quotes.test.ts` entry;
  after rebasing onto `main` at `03445aafd`, `main` carries that entry itself, so the
  duplicate was removed during the pre-handoff rebase repair.) The inventory comment
  avoids literal git command text, because the suite's
  boundary heuristic reads such text and would reclassify `default-test-suite.test.ts`
  itself as an integration test.

Documentation: no authored documentation describes the landed squash payload's backlog
handling (`grep -rln "px integrate" docs README.md` finds only lifecycle/rebound,
publishing, and board prose), so per AGENTS.md ("Documentation" — volatile implementation
facts stay in code and tests) and the mission's "only if the meaning of documented
behavior changes" condition, no docs sentence was added. `./scripts/verify-local.sh all`
includes the authored-documentation check, which passes.

## SC5 demonstration (red, then green)

With a temporary uncommitted duplicate copied into `backlog/tasks/`
(`task-1088 - Resolve-task-1063-rebase-conflict-and-capture-recovery-learnings.md`,
copied from `backlog/completed/`, then deleted — never committed; `git status --short`
showed only the new test file afterwards):

```
✖ TASK-2534: the repository has no stale backlog/tasks copies of completed tasks
```

On the clean tree:

```
✔ TASK-2534: the repository has no stale backlog/tasks copies of completed tasks
✔ TASK-2534: squash landing drops the stale task-9001 copy and keeps new task-9002
✔ TASK-2534: landing aborts before the squash commit when a duplicate survives closeout
ℹ pass 3
ℹ fail 0
```

## Gate output tails

`./scripts/verify-local.sh static-analysis`

```
[4/4] Running test typecheck...
PASS: test typecheck clean
=== Static Analysis Gate: ALL STAGES PASSED ===
```

`./scripts/verify-local.sh all` (exit status 0)

```
ℹ tests 2665
ℹ pass 2665
ℹ fail 0
[unit-test-budget] timeout=1000ms per test, suite budget=180000ms, elapsed=60839ms
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 stale `task-9001` copy absent from the landed commit; red before the fix | `test/task-2534-stale-backlog-copy-landing-repro.test.ts`, test name `TASK-2534: squash landing drops the stale task-9001 copy and keeps new task-9002`; CP-1 recorded the red line `landed commit must not contain backlog/tasks/task-9001 - x.md` | PASS |
| SC2 new `task-9002` file still lands | Assertion `landed commit must contain backlog/tasks/task-9002 - new.md` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts` | PASS |
| SC3 landing log names the task id and canonical path | Assertion `an info line names task-9001 and backlog/completed/task-9001 - x.md` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts` | PASS |
| SC4 abort before the squash commit when a duplicate survives closeout | Test name `TASK-2534: landing aborts before the squash commit when a duplicate survives closeout` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts`, asserting the abort, the listed offending path, and `no squash commit is created` | PASS |
| SC5 repo-state CI guard, unit tier, no git calls | `test/task-2534-backlog-repo-state.test.ts`, test name `TASK-2534: the repository has no stale backlog/tasks copies of completed tasks`; red-with-temporary-duplicate transcript above; runs under `npm test` (absent from `INTEGRATION_CI_TESTS` in `test/lib/test-categories.ts`) | PASS |
| SC6 fixture mirrors `mission/task-2489` / `mission/task-2478` | `buildFixture()` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts`: canonical file reaches `main` through a squash commit, stale copy exists only in unsquashed branch history; zero stale `backlog/tasks/` paths land | PASS |
| SC7 `github-pr.ts` finding recorded | CP-2 section "SC7 finding": no local payload is built — `src/application/integrate/github-pr.ts:2` (header: GitHub owns the merge), `:22` (`rev-parse` only), `:45-46` (`submitOrObserveGithubPr`); file unchanged | PASS |
| SC8 scope, no weakened checks | Changed source files: `src/application/integrate/squash.ts`, `src/application/ports/integrate-workflow.ts`, `src/adapters/cli/commands/integrate.ts` (port wiring reason in CP-2), `test/lib/test-categories.ts`, `test/default-test-suite.test.ts` (reason above), plus the two new test files; the test-hygiene stage of `./scripts/verify-local.sh static-analysis` enforces no `.only` / no bare `.skip` | PASS |
| SC9 both gates green on the final tree | `./scripts/verify-local.sh static-analysis` (ALL STAGES PASSED) and `./scripts/verify-local.sh all` (exit 0, 2665 tests, 0 fail) — tails quoted above | PASS |

Next action: hand off to review; Parallix owns the lifecycle transition for TASK-2534.
