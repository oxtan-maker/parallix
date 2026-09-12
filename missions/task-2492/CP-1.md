# CP-1 — Trace the failure paths; define the classification, retry boundary, and outcomes in tests before changing behavior

## Summary

Traced the two failure sites in `src/adapters/cli/commands/integrate.ts`: the
squash-commit hook failure (already routed through the rebound kernel) and the
integration-gate failure (which previously dead-ended in `IntegrationAbort`).
Confirmed the existing rebound kernel (`src/application/rebound-kernel.ts`) owns
classification, fix-prompt, launch, and verify-loop once, and that the
squash-hook path builds its kernel context from injectable seams so tests keep a
mock launch/transition/fallback port.

Defined the new integration-gate contract in focused tests **before** changing
`integrate.ts` behavior, per the checkpoint requirement. The routing module
`src/adapters/cli/commands/integrate-gate-rebound.ts` and its contract test
`test/task-2492-integration-gate-rebound.test.ts` encode:

- **Failure classification** — one failed `runPhaseGates('integration', …)` run
  classifies as a `gate-failure` reason (`integrationGateFailureReason`) that the
  kernel classifies as `GateFailure` / relaunchable.
- **Retry-count reset boundary** — the persisted budget is the count of
  append-only `integration.gate-rebound` rows keyed on the mission id
  (`missionId(slug)`), so it never resets inside a mission and never carries
  into another. Two concurrent processes cannot consume one counter.
- **Operator-facing outcomes** — exactly four routes: `fixed`, `exhausted`,
  `mainline`, `limit-reached` (plus `stranded` for the pre-TASK-2492 abort).

The squash-hook path was kept as the regression anchor: `task-2377.05` verifies
the existing kernel bounce still lands and still strands on budget exhaustion.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Integration-gate failure classified before behavior change | `test/task-2492-integration-gate-rebound.test.ts`, test "the integration gate failure classifies as an auto-send-back gate failure" | PASS |
| Retry reset boundary defined and tested | `test/task-2492-integration-gate-rebound.test.ts`, test "the persisted rebound budget is keyed on the mission and never resets inside it" | PASS |
| All four operator outcomes defined in tests | `test/task-2492-integration-gate-rebound.test.ts`: "a mission regression inside budget bounces once…", "a gate failure reproducing on main creates one backlog task and never bounces", "an exhausted rebound budget escalates to a human…" | PASS |
| Existing squash-hook rebound path anchored as regression | `test/task-2377.05-integrate-squash-bounce.test.ts`, tests "S1: hook failure bounces through the kernel and lands…" and "S2: two failed re-run commits exhaust the budget and throw IntegrationAbort" | PASS |
| Static-analysis gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action

Implement the recoverable mission-regression path in `integrate.ts` (CP-2): wire
`routeIntegrationGateFailure` into the `!result.ok` branch and refactor the
implementer resolution shared with the squash-hook bounce.
