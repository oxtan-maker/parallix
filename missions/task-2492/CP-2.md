# CP-2 — Recoverable mission-regression path via the shared rebound kernel

## Summary

Implemented the recoverable route for an approved mission whose integration gate
goes red. `integrate.ts` no longer `IntegrationAbort`s on `!result.ok`; it calls
`routeIntegrationGateFailure`, which for a mission regression inside budget
spends the persisted rebound budget, transitions the task back to `active`,
launches the implementer once with the gate evidence, and re-runs the identical
gate set — reporting `fixed` only on a passing re-run.

Two handoff facts flow through the kernel's `GateFailureReason.coverageNote`
slot (not mixed into the diagnostic): the failed gate command and, when the gate
command differs from the mission's ordinary verification command, an explicit
"integration-only" note so the implementer knows a green `verify-local.sh` does
not close the failure (the TASK-2483 stall mechanism).

The implementer-resolution chain was extracted once into `resolveBounceImplementer`
and is now shared by both bounces (squash-hook and integration-gate), so the two
paths cannot drift apart. The squash-hook regression coverage stays green.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mission-regression failure below retry limit bounces once and relaunches exactly one implementer | `test/task-2492-integration-gate-rebound.test.ts`, test "a mission regression inside budget bounces once, re-runs the gates, and reports fixed" | PASS |
| Handoff names the failed gate command | `test/task-2492-integration-gate-rebound.test.ts`, test "the bounced prompt names the failed gate command and the integration-only coverage fact" | PASS |
| Handoff states integration-only when the gate is not ordinary verification | `test/task-2492-integration-gate-rebound.test.ts`, tests "a gate command that is not the ordinary verification command is reported as integration-only" and "a gate command identical to the ordinary verification command carries no integration-only note" | PASS |
| Failed gate output survives into the handoff | `test/task-2492-integration-gate-rebound.test.ts`, test "the bounced prompt names the failed gate command…" asserts `/review-identity-placeholder/` | PASS |
| Existing squash-hook rebound unchanged for recoverable mission-local failure | `test/task-2377.05-integrate-squash-bounce.test.ts`, tests "S1: hook failure bounces through the kernel and lands…" and "S2: two failed re-run commits exhaust the budget and throw IntegrationAbort" | PASS |
| CLI wires the gate failure through the routing seam with failed gate + named implementer | `test/task-2492-integrate-gate-bounce.test.ts`, test "a red integration gate routes through the seam with the failed gate and a named implementer" | PASS |
| Static-analysis gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action

Implement and test the `main`-reproduction route and the finite-retry
escalation so neither relaunches the implementer (CP-3).
