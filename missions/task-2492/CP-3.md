# CP-3 — Main-reproduction route and finite-retry escalation

## Summary

Implemented the two non-bouncing routes so a persistently red or mainline-red
gate never loops the implementer.

- **Mainline route** — `probeBaseBranchReproduction` re-runs the single failed
  gate command in the existing base worktree through the same `runPhaseGates`
  runner, and refuses to run at all unless that worktree is already on the base
  branch with a clean tree. It never checks out, resets, fetches, or pushes, so
  no shared branch is mutated to obtain the answer (the mission's Stop-Risk on
  `main` reproduction). When the gate reproduces, `createMainlineGateTask` writes
  one deterministically identified backlog task (`TASK-MAINGATE-<hash>`), records
  a bounded elided excerpt, and the implementer is not bounced.
- **Finite-retry escalation** — `routeIntegrationGateFailure` reads the persisted
  `integration.gate-rebound` budget first; at/above `INTEGRATION_GATE_REBOUND_LIMIT`
  it reports a human-actionable escalation (names the reproduction command) and
  does not transition to `active` or launch an implementer. The budget is spent
  before the launch, so a process that dies mid-repair still paid for the attempt.

Neither route relaunches the implementer; both are covered by focused tests.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Main-reproduction failure leaves the rebound path, creates one backlog task, reports escalation | `test/task-2492-integration-gate-rebound.test.ts`, test "a gate failure reproducing on main creates one backlog task and never bounces" | PASS |
| Mainline task identity is deterministic and outside the TASK-NNNN range | `test/task-2492-integration-gate-rebound.test.ts`, test "the mainline task identity is derived from the gate key and the base commit" | PASS |
| Mainline task written once, not duplicated | `test/task-2492-integration-gate-rebound.test.ts`, test "the mainline task is written once and re-resolves instead of duplicating" | PASS |
| Finite rebound limit escalates to human without transition or launch | `test/task-2492-integration-gate-rebound.test.ts`, test "an exhausted rebound budget escalates to a human without a transition or a launch" | PASS |
| Budget spent before launch (dies-mid-repair still pays) | `test/task-2492-integration-gate-rebound.test.ts`, test "a bounce whose re-run stays red reports exhausted without a second launch" | PASS |
| Undeterminable reproduction is not fabricated into a mainline task | `test/task-2492-integration-gate-rebound.test.ts`, test "an undeterminable base-branch reproduction is treated as a mission regression" asserts no mainline task invented | PASS |
| CLI aborts on non-fixed and limit-reached routes | `test/task-2492-integrate-gate-bounce.test.ts`, tests "a non-fixed route aborts before merge" and "a limit-reached route aborts before merge" | PASS |
| Static-analysis gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Next action

Run the configured integration gate and reconcile every success criterion against
durable evidence, then prepare the final handoff (CP-4).
