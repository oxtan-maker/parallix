# CP-3: Gates and durable evidence

## Summary

Ran the targeted regression coverage and both mission-declared gates on the
committed tree (`faa666130`).

- Targeted: `npx tsx --test test/task-2504-repro.test.ts test/task-2492-integration-gate-rebound.test.ts test/task-2377.03-rebound-kernel.test.ts` — 47 pass, 0 fail.
- `./scripts/verify-local.sh static-analysis` — ESLint, `npm run typecheck`, test-hygiene, and test typecheck all clean.
- `./scripts/verify-local.sh all` — exit code 0, 2559 tests pass, 0 fail. (The `[FAIL]` strings in that log are fixture output asserted by rebound/integration tests, not gate failures; the gate exit status is 0.)

No documentation change: the repair only reworded one rebound prompt slot and
changed no user-facing workflow contract, per `AGENTS.md` documentation policy.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1. Gate-failure remedy requires a committed repair and names the uncommitted consequence | `src/application/rebound-kernel.ts` (`promptSlotsFor`, `gate-failure` case); `TASK-2504: the integration-gate bounce prompt requires committing the repair before re-verification` | PASS |
| 2. Reproduction test red at parent, green after fix | `test/task-2504-repro.test.ts` via `npx tsx --test test/task-2504-repro.test.ts`: red at mission parent `8146e55f0` with `AssertionError: the remedy requires a commit before re-verification`; green at `faa666130` | PASS |
| 3. Dirty-tree guard through `routeIntegrationGateFailure` still rejects an uncommitted repair | `TASK-2504: an uncommitted repair is still rejected by the finalized-tree guard`; `TASK-2492: a repair left uncommitted fails the re-run instead of being reported as fixed` | PASS |
| 4. Existing integration-gate rebound behavior still covered | `test/task-2492-integration-gate-rebound.test.ts` and `test/task-2377.03-rebound-kernel.test.ts` — 47 pass, 0 fail with the repro file | PASS |
| 5. Required repository gates green on the final tree | `./scripts/verify-local.sh static-analysis` (ALL STAGES PASSED); `./scripts/verify-local.sh all` (exit 0, 2559 pass / 0 fail) | PASS |

Next action: hand the mission to review; no follow-up work remains in mission scope (the repair-agent fallback-commit option from the Backlog description was deliberately not built — the mission selected the prompt-only remedy).
