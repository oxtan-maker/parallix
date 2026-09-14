# CP-3 — Mission-only rebound stays bounded

## Summary

Extended `test/task-2507-mainline-gate-mutation-repro.test.ts` with coverage for the preserved mission-only route.
The failed-gate route arguments were factored into one `routeArgs(base, over)` builder shared by both scenarios, so
each scenario differs only in the injected base-branch probe and rebound budget; the base worktree remains the real
fixture Git repository in both.

The new test drives two invocations against that fixture:

- budget `0` with a probe reporting "passes on main" — asserts route `fixed`, exactly one implementer launch, one
  transition back to the implementer, and one persisted rebound recorded before the launch;
- budget `INTEGRATION_GATE_REBOUND_LIMIT` — the launcher, transition, and budget-record seams throw if called, and
  the route is `limit-reached`, proving the configured retry bound is unchanged.

Both invocations end with a byte-level snapshot comparison and an empty `git status --porcelain` on the base
worktree, so the mission-only path is also proven not to mutate the primary checkout.

No authored documentation describes the removed mainline-ticket behaviour (`grep` over `docs/` for
`MAINGATE`/`mainline` returns nothing), so there is no live documentation to update.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mission-only gate failure still takes the bounded rebound path | `"TASK-2507: a gate failure that reproduces only in the mission worktree still bounces once within its retry bound and leaves the base worktree clean"` in `test/task-2507-mainline-gate-mutation-repro.test.ts` | PASS |
| Configured retry bound preserved | same test — second invocation at `INTEGRATION_GATE_REBOUND_LIMIT` returns `limit-reached` with throwing launch/transition/record seams | PASS |
| Existing rebound regression suite still green | `test/task-2492-integration-gate-rebound.test.ts`, `test/task-2504-repro.test.ts` | PASS |
| New Git-boundary test classified in both tier registries | `test/lib/test-categories.ts`, `test/default-test-suite.test.ts` (`"default test runner routes every moved group to integration and excludes it from default"`) | PASS |
| Repository verification gate passes | `./scripts/verify-local.sh all` — exit status 0 | PASS |

Next action: CP-4 — re-run `./scripts/verify-local.sh all`, inspect `git diff 77b3d16d6..HEAD` for unintended primary-checkout or backlog mutations, and record final evidence for every mission success criterion.
