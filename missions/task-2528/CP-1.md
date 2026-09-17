# CP-1 — Reproduction test for the bypassed PR re-review

## Summary

Authored `test/task-2528-repro.test.ts` before any production change. The file
models the reported scenario at the unit level, driving the real recovery entry
point `routeIntegrationGateFailure` with every boundary injected: no database,
no agent launch, no gate execution, and no Forgejo call.

The fixture is a mission whose reviewer approved revision `approved-tree` and
whose PR is open with a standing `APPROVED`. An integration gate reports an
integration error; the injected implementer relaunch performs the repair by
advancing the mission worktree HEAD to `repaired-commit`/`repaired-tree`; the
identical gate set then re-runs green. A second, paired scenario runs the same
recovery where the relaunch changes nothing (the flaky-gate retry), so the
unchanged-retry constraint is pinned by the same file from the start.

Two tests:

- `TASK-2528: a post-integration-error repair that changes the mission diff cannot land on the prior approval`
  — asserts the route is not the `fixed` route the caller merges on, that it is
  the distinct `revision-changed` route, that the mission was handed back to the
  implementer exactly once, and that the standing approval was invalidated once
  for the approving reviewer with the approved and repaired revisions named as
  evidence.
- `TASK-2528: an unchanged retry after the same integration error still lands on its existing approval`
  — asserts the route stays `fixed` and that nothing retracts the approval.

At the mission parent commit the first test fails on its first assertion with
`actual: 'fixed'`: the recovery reports the merge-permitting route for a
revision the reviewer never saw. The second test already passes, which is the
point — it is the guard against over-invalidating.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| A regression test fails at the mission parent commit and will pass after the fix | `test/task-2528-repro.test.ts`; test name `"TASK-2528: a post-integration-error repair that changes the mission diff cannot land on the prior approval"`; run `./node_modules/.bin/tsx --test test/task-2528-repro.test.ts` — fails with `actual: 'fixed'`, `expected: 'fixed'`, `operator: 'notStrictEqual'` | Red as designed |
| The changed-revision retry must not proceed under the prior approval | Same test asserts `route.route !== 'fixed'` and `route.route === 'revision-changed'`; the caller's merge boundary is `src/application/integrate/gates.ts`, which aborts for every non-`fixed` route (already pinned by `"TASK-2492: a non-fixed route aborts before merge (IntegrationAbort → exit 1)"` in `test/task-2492-integrate-gate-bounce.test.ts`) | Covered, red |
| The changed revision routes back to review and invalidates the approval | Same test asserts one implementer hand-back (`transitionTaskFn`) and exactly one approval invalidation carrying `slug`, `branch`, and `reviewerUser` | Covered, red |
| An unchanged post-error retry still lands without a new review round | Test name `"TASK-2528: an unchanged retry after the same integration error still lands on its existing approval"` in `test/task-2528-repro.test.ts` — passes at the parent commit | Green, guards over-invalidation |
| Gate execution, evidence capture, bounded rebounds, and the pre-landing guard are untouched | No production file changed in this checkpoint; the existing suites `test/task-2492-integration-gate-rebound.test.ts`, `test/task-2507-mainline-gate-mutation-repro.test.ts`, and `test/task-2517-integrate-rebound-landing-guard.test.ts` remain the authority for those behaviours | Unchanged |
| `./scripts/verify-local.sh all` succeeds on the completed mission tree | Deferred to CP-3 by design: the reproduction test is red until CP-2 lands the fix | Deferred |

Next action: implement the revision-aware recovery transition in
`src/adapters/cli/commands/integrate-gate-rebound.ts` so
`./node_modules/.bin/tsx --test test/task-2528-repro.test.ts` turns green.
