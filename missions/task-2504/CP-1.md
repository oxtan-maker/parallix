# CP-1: Reproduction test for the missing commit instruction

## Summary

Added `test/task-2504-repro.test.ts`, which drives `routeIntegrationGateFailure`
with injected boundaries (agent launcher, rebound budget, base-branch probe,
finalized-tree capture, gate runner). The injected launcher captures the fix
prompt the rebound kernel builds for the integration-gate bounce.

- `TASK-2504: the integration-gate bounce prompt requires committing the repair before re-verification`
  asserts the gate-failure prompt requires a commit before re-verification and
  states that an uncommitted repair cannot be verified.
- `TASK-2504: an uncommitted repair is still rejected by the finalized-tree guard`
  asserts a dirty mission tree is not reported as fixed and yields
  "The repair is not committed".

No production code was changed in this checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1. Gate-failure remedy requires commit and states uncommitted consequence | `test/task-2504-repro.test.ts`, `TASK-2504: the integration-gate bounce prompt requires committing the repair before re-verification` (assertion authored; production change pending CP-2) | PENDING |
| 2. Repro test red at mission parent | `npx tsx --test test/task-2504-repro.test.ts` at parent `8146e55f0`: `TASK-2504: the integration-gate bounce prompt requires committing the repair before re-verification` fails with `AssertionError: the remedy requires a commit before re-verification` (red); green-after-fix recorded in CP-2 | RED CONFIRMED |
| 3. Dirty-tree guard in `routeIntegrationGateFailure` stays in force | `test/task-2504-repro.test.ts`, `TASK-2504: an uncommitted repair is still rejected by the finalized-tree guard` passes | PASS |
| 4. Existing integration-gate rebound coverage retained | `test/task-2492-integration-gate-rebound.test.ts` untouched; run in CP-3 | PENDING |
| 5. Repository gates pass | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all` run in CP-3 | PENDING |

Next action: add the commit-before-re-verify sentence to the `gate-failure` remedy in `promptSlotsFor` (`src/application/rebound-kernel.ts`) and rerun `npx tsx --test test/task-2504-repro.test.ts` to green.
