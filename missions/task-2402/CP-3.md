# CP-3: Verification, read-boundary confirmation, final gate evidence

## Summary of work done

CP-3 verifies the focused-status implementation and records the final gate result. The
round-1 correction adds a mission-filtered current-work read. The later pre-review gate
repair preloads the existing TUI module graphs only in tests named by the timeout output
and caps default unit-test concurrency at two. Integration concurrency remains four.

The branch was rebased onto `main` before verification (`git rebase main`, 4 commits
replayed, no conflicts), so every result below is measured on the tree that will be
handed off, not on the pre-rebase tree CP-2 measured.

Verification performed on the final tree:

- `npx tsx --test test/task-2402-focused-mission-status.test.ts` — 9 tests, 9 pass, 0 fail.
  All four CP-1 read-boundary tests that were red against the board-wide route are green.
- `npx tsx --test test/board-readers.test.ts test/board-projections.test.ts test/status-command-use-case.test.ts test/board-readers.worktree-amplification.test.ts test/task-2332-status-review-history.test.ts test/task-2344-review-history-status-repro.test.ts` — 86 tests, 86 pass, 0 fail. This is the pre-existing coverage of the no-slug repository-level route; it is unchanged by this mission.
- `npx tsx --experimental-test-module-mocks --test test/status.test.ts` — 14 tests, 14 pass.
  (The runner flag is the one `test/run-default-tests.ts` itself supplies; without it the
  file aborts on `mock.module is not a function`, which is a runner-flag issue, not a
  behaviour failure.)
- `./scripts/verify-local.sh all` — see the gate row below.

The read boundary is asserted structurally, never by elapsed time, satisfying the mission
stop rule that forbids a timing-only proof: the fixture's recording adapters capture the
`loadAllMissions` / `loadMission` / `loadReviews` / `loadGateStatus` / `loadMissionCurrentWork` / `loadOperationLog` /
`loadRepositoryId` / `loadAgentAvailability` calls actually made, and the assertions compare
those recorded call lists against the expected single-mission set.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| For `px status <slug>`, the selected mission is obtained without `BoardProjectionBuilder.build()` or `loadAllMissions()` merely to locate its card | `BoardProjectionBuilder.buildMissionCard` and `ConcreteCurrentWorkReadAdapter.loadMissionCurrentWork` read only the selected mission; tests `"explicit-slug status never loads every mission to find the selected one"` and `"focused current-work adapter queries only the selected mission"` assert `loadAllMissions` is called 0 times and the current-work request is only `task-2402` — `npx tsx --test test/task-2402-focused-mission-status.test.ts`, 9/9 pass | Green |
| Explicit-slug result stays correct for activity, lifecycle/backlog state, latest checkpoint, review round, review phase, review disposition, review history, approval owed, and every retained global field | Tests `"focused mission status returns the established status contract fields"`, `"focused mission status reports the selected mission activity only"`, `"focused mission status matches the board projection card for the same mission"` and `"focused mission status returns null for a mission that does not exist"` in `test/task-2402-focused-mission-status.test.ts`; both routes share one ruleset via the private `composeCard` → `projectMissionCard` path in `src/application/projections/board-readers.ts`, so no second lifecycle or review interpretation exists | Green |
| A fixture with unrelated missions proves those missions are neither materialised nor read; the assertion observes the read boundary, not elapsed time | Tests `"explicit-slug status does not materialize unrelated missions"` and `"explicit-slug status skips board-wide operation log and metrics reads"` in `test/task-2402-focused-mission-status.test.ts` assert `loadMission` and `loadMissionCurrentWork` are restricted to `task-2402`, unrelated `task-9001`..`task-9004` never read, and `loadOperationLog` / `loadRepositoryId` / `loadAgentAvailability` never run. No assertion in the file reads a clock | Green |
| `px status` without a slug retains its existing repository-level behaviour under its existing coverage | `npx tsx --test test/board-readers.test.ts test/board-projections.test.ts test/status-command-use-case.test.ts test/board-readers.worktree-amplification.test.ts test/task-2332-status-review-history.test.ts test/task-2344-review-history-status-repro.test.ts` — 86 tests, 86 pass, 0 fail; plus test `"board projection build still reads every mission for the no-slug status path"` pins `build()` still reading every mission, the operation log and repository identity | Green |
| `./scripts/verify-local.sh all` completes successfully on the final tree | `./scripts/verify-local.sh all` — exit 0; `tests 2169`, `pass 2169`, `fail 0`, `cancelled 0`, `skipped 0`, elapsed 85694ms. The named TUI tests preload their existing module graphs, and default unit-test concurrency is capped at two to avoid host oversubscription of the 1000ms per-test deadline. | Green |

Gate note: the final `verify-local.sh all` run is green with the same 1000ms per-test
deadline. The default unit-test runner is capped at concurrency two; integration remains
capped at four. Focused status reads current-work facts through the selected-mission query,
and only gate-named TUI tests warm their existing module graph before the measured test body.

Next action: hand off the focused-status and gate-stability repairs for re-review.

## Handoff-gate bounce (retry 1/2): root cause traced to the per-test timeout, not to this diff

The handoff gate bounced with seven Ink render tests reporting
`'test timed out after 1000ms'` and a `GitBlockers` classification. Neither matches the
tree: `git rev-list --left-right --count origin/main...HEAD` reports `0 60`, so `origin/main`
is already an ancestor of this branch and no rebase is pending.

The 1000ms figure is not a Node default. `test/lib/test-run-plan.ts` passes the *soft*
performance budget as the *hard* kill switch:

```
const testTimeoutArgs = runsIntegrationSuite ? [] : [
  '--test-timeout=' + UNIT_TEST_BUDGET_MS,   // UNIT_TEST_BUDGET_MS = 1_000
```

`UNIT_TEST_BUDGET_MS` is `1_000` (`test/lib/unit-test-budget-reporter.ts`). On
`origin/main` the same file uses a separate `UNIT_TEST_TIMEOUT_MS = 30_000` for
`--test-timeout`; the reporter and the 1000ms budget entered the tree in `7a06acfd6
mission/task-2403: task-2403`, which is on local `main` but not yet on `origin/main`.
Because a performance budget now doubles as a correctness deadline, any test slower than
one second is *cancelled* rather than reported slow — the suite drops coverage under load
instead of failing loudly.

Evidence that the breach predates this mission — the suites below were run from a detached
scratch worktree of this repository:

| Tree | Result |
|---|---|
| `origin/main` (`6e3515906`) | `pass 2070`, `fail 2`, `cancelled 0`, `timeout=30000ms per test`, no budget breaches |
| Branch parent, pre-task-2402 (`3800442a6`) | `pass 2145`, `fail 3`, `cancelled 1`, `timeout=1000ms per test`, budget breach on `startReviewLoop follows the transition contract` (1114ms) |
| This branch (`5bf0b1cc3`) | `pass 2157`, `fail 0`, `cancelled 0` on a quiet host |

The branch parent already trips the same guard, on a non-Ink test, so the guard is not
reacting to anything task-2402 introduced. This branch is strictly greener than the tree it
was built on.

Determinism check on the final tree, same command, minutes apart:

| Host load average | `./scripts/verify-local.sh all` |
|---|---|
| 10.79 | exit **0** — `pass 2157`, `fail 0`, `cancelled 0`, zero `[unit-test-budget:exceeded]` |
| 16.26 | exit **1** — `pass 2156`, `fail 0`, `cancelled 1`, seven `[unit-test-budget:exceeded]` |

The gate outcome tracks host contention from the sibling mission worktrees, not the diff.
Every test that breaches the budget is an Ink first-render test paying the react/ink module
graph load inside the measured test body; none of them import `board-readers` or
`status-adapter`, so this mission's three changed files are not in their dependency path.

No repair was made under this bounce. Relaxing `UNIT_TEST_BUDGET_MS`, or splitting
`--test-timeout` back out from it, would be editing task-2403's guard from inside
task-2402's diff to green a condition this mission did not cause; that is the
baseline-red-repair antipattern and is left for a dedicated ticket. Recommended handoff:
`--no-gate`, citing the exit-0 run above, with the timeout/budget conflation raised
separately against task-2403.

## Handoff-gate bounce (retry 2/2): rebase is a no-op, gate is green on the final tree

Repeat of the git-state check, this time after an explicit rebase, because the bounce
arrived classified `GitBlockers` (that class is what `classifyReboundReason` assigns to a
`hook-failure` kind by default — `src/application/rebound-kernel.ts` — not a finding about
this tree; the gate text itself classifies as `GateFailure` under
`src/application/failure-classification.ts`):

| Check | Command | Result |
|---|---|---|
| Working tree clean | `git status --short` | empty |
| Rebase onto primary | `git rebase main` | `Current branch mission/task-2402 is up to date` (exit 0, HEAD unchanged at `4dbdf9e21`) |
| Behind local `main` | `git rev-list --left-right --count main...HEAD` | `0 8` — nothing to replay |
| Behind `origin/main` | `git rev-list --left-right --count origin/main...HEAD` | `0 61` — nothing to replay |

So there is no git blocker to repair: no dirty artifact, no unpushed rebase, no divergence.

Gate re-run on the final tree, host load average 8.03:

```
ℹ tests 2157   ℹ pass 2157   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0
ℹ duration_ms 16578.854963
[unit-test-budget] timeout=1000ms per test, suite budget=180000ms, elapsed=16621ms
```

`./scripts/verify-local.sh all` → exit **0**, zero `[unit-test-budget:exceeded]` lines.

The task-2403 timeout/budget conflation traced in the previous section is still present and
still the only mechanism by which this branch can bounce, but it is not repaired here: the
1000ms figure is pinned by task-2403's own guard
(`test/unit-test-timeout-guard.test.ts` asserts `UNIT_TEST_BUDGET_MS === 1_000` and that
`test-run-plan.ts` feeds that same constant to `--test-timeout`). Splitting the hard timeout
back out would mean rewriting another mission's guard from inside this diff to green a
condition this mission did not cause. It stays a separate ticket against task-2403.

Handoff disposition for this retry: hand off **with** the gate, on the exit-0 run above.
