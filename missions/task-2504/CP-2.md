# CP-2: Gate-failure remedy requires a committed repair

## Summary

Changed one sentence of the `gate-failure` remedy in `promptSlotsFor`
(`src/application/rebound-kernel.ts`): "Parallix reruns this exact gate after
the repair." became a statement that the implementer must commit the repair
before the automatic re-verification, because the gate reruns against the
finalized mission tree and an uncommitted repair cannot be verified.

No automatic-commit path was added, no other rebound slot was touched, and the
dirty-tree guard in `routeIntegrationGateFailure` is unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1. Gate-failure remedy requires commit and states uncommitted consequence | `src/application/rebound-kernel.ts` (`promptSlotsFor`, `gate-failure` case); `TASK-2504: the integration-gate bounce prompt requires committing the repair before re-verification` passes | PASS |
| 2. Repro test red at parent, green after fix | `npx tsx --test test/task-2504-repro.test.ts`: red at `105df3fd4`/`8146e55f0` with `AssertionError: the remedy requires a commit before re-verification`; green after this prompt change | PASS |
| 3. Dirty-tree guard still rejects an uncommitted repair | `TASK-2504: an uncommitted repair is still rejected by the finalized-tree guard` and `TASK-2492: a repair left uncommitted fails the re-run instead of being reported as fixed` both pass | PASS |
| 4. Existing integration-gate rebound coverage intact | `npx tsx --test test/task-2492-integration-gate-rebound.test.ts test/task-2377.03-rebound-kernel.test.ts`: 47 pass, 0 fail (with the repro file) | PASS |
| 5. Repository gates pass | `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh all` run in CP-3 | PENDING |

Next action: run `./scripts/verify-local.sh static-analysis` and `./scripts/verify-local.sh all` on the committed tree and record their outcomes in CP-3.
