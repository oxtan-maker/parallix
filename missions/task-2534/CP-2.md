# CP-2: Fix (green)

## Summary

Changed files and why:

- `src/application/integrate/squash.ts` — added the single new helper
  `dropStaleBacklogCopies(run, stagedPaths)`, called after `squashMerge(...)` and
  before the payload capture. It reuses `checkBacklogIntegrity` (no third scanner),
  keeps only `duplicate-completed` issues whose path is in the squash-staged set
  (so unstaged trailing backlog noise is untouched), and requires the canonical
  file to exist at base `HEAD` (`git cat-file -e HEAD:<canonical>`) so the landing
  mission's own pending closeout is never dropped. Each stale path is unstaged
  (`git reset -q HEAD -- <path>`), removed from the working tree (`git checkout HEAD --`
  when the base branch carries the path, otherwise `git clean -f --`), and logged
  through `fmt.log.info` naming the task id and the canonical path. The payload
  capture was turned into `capturePayloadPaths()` so it can run once for the filter
  input and once for `intendedPayloadPaths`. After `stageCloseout(...)` and before
  `commitLandedSquash(...)`, a fail-closed backstop re-runs
  `backlog.checkBacklogIntegrity(baseWorktree)` repo-wide and, for any surviving
  `duplicate-completed` issue, throws `abortWith(landing, ...)` listing the paths.
- `src/application/ports/integrate-workflow.ts` and
  `src/adapters/cli/commands/integrate.ts` — **written reason (SC8)**: this codebase
  is hexagonal; `src/application/` never imports `src/adapters/` (no such import
  exists anywhere under `src/application/`). Reusing the existing
  `checkBacklogIntegrity` from the application layer therefore requires one new
  method on `IntegrateBacklogPort` plus its one-line wiring in the CLI adapter.
  No new scanner, no new dependency, no behavior added in either file.
- `test/task-2534-stale-backlog-copy-landing-repro.test.ts` — added the SC4 abort
  test alongside the CP-1 reproduction.

### Assumption recorded (mission "Risks and Assumptions")

`checkBacklogIntegrity` scans the working tree, which right after `git merge --squash`
already contains the stale files. "Canonical at base `HEAD`" is therefore decided by
`git cat-file -e HEAD:<canonicalFile>` against the base worktree, not by the
working-tree scan.

### SC7 finding: `github-pr.ts` builds no local payload — unchanged

`src/application/integrate/github-pr.ts` performs exactly one local git call,
`git.git(['-C', baseWorktree, 'rev-parse', branch])` (`src/application/integrate/github-pr.ts:22`),
and then hands the merge to GitHub via `github.submitOrObserveGithubPr(...)`
(`src/application/integrate/github-pr.ts:45-46`). There is no `merge`, no `commit`,
and no staged-path capture, matching the file's header comment "GitHub owns the
merge" (`src/application/integrate/github-pr.ts:2`). No local payload is built, so
the file is unchanged.

## Test output tail

`npx tsx --test test/task-2534-stale-backlog-copy-landing-repro.test.ts`

```
✔ TASK-2534: squash landing drops the stale task-9001 copy and keeps new task-9002
✔ TASK-2534: landing aborts before the squash commit when a duplicate survives closeout
ℹ tests 2
ℹ pass 2
ℹ fail 0
```

`./scripts/verify-local.sh static-analysis`

```
=== Static Analysis Gate: ALL STAGES PASSED ===
```

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 stale `task-9001` copy absent from the landed commit | Test name `TASK-2534: squash landing drops the stale task-9001 copy and keeps new task-9002` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts`; red before the fix with `landed commit must not contain backlog/tasks/task-9001 - x.md` (CP-1), green now | PASS |
| SC2 new `task-9002` file still lands | Assertion `landed commit must contain backlog/tasks/task-9002 - new.md` in the same test | PASS |
| SC3 log names the task id and canonical path | Assertion `an info line names task-9001 and backlog/completed/task-9001 - x.md` in the same test | PASS |
| SC4 fail-closed abort with the offending path, base `HEAD` unchanged | Test name `TASK-2534: landing aborts before the squash commit when a duplicate survives closeout` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts`, asserting the abort error, the listed path, and `no squash commit is created` | PASS |
| SC6 fixture mirrors `mission/task-2489` / `mission/task-2478` | `buildFixture()` in `test/task-2534-stale-backlog-copy-landing-repro.test.ts`; zero stale `backlog/tasks/` paths land | PASS |
| SC7 `github-pr.ts` finding recorded | `src/application/integrate/github-pr.ts:2`, `:22`, `:45-46` — no local payload, file unchanged (see section above) | PASS |
| SC8 scope and no weakened checks | Changed files listed above with the written reason for the two port-wiring files; `./scripts/verify-local.sh static-analysis` includes the test-hygiene stage (no `.only`, no bare `.skip`) | PASS |
| SC9 static-analysis gate | `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS (full `all` gate pending CP-3) |

Next action: add `test/task-2534-backlog-repo-state.test.ts` (unit tier, no git calls), demonstrate SC5 red with a temporary uncommitted duplicate, then run `./scripts/verify-local.sh all` for the final Goal Check.
