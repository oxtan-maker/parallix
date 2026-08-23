# CP-4: TASK-2332.04 — `ExecuteMission` owns active mission execution

## Summary

TASK-2332.04 replaced the `LegacyActiveAdapter` workflow with an application-owned
`ExecuteMission` use case. This checkpoint verified the replacement on the
integrated tree; no production change was required.

Verified state:

- `LegacyActiveAdapter` has no occurrence in `src/` (`grep -rn "LegacyActiveAdapter" src/`
  returns 0 matches). The only remaining mentions are historical comments in
  `test/execute-mission-characterization.test.ts` and `test/sqlite-recovery-cp5.test.ts`
  that explain what the characterization is holding constant.
- Sequencing and partial-failure policy live in `src/application/execute-mission-service.ts`;
  the mechanism contracts live in `src/application/ports/execute-mission.ts`
  (`MissionWorkspacePort`, `AgentExecutionPort`, `ExecuteTelemetryPort`,
  `HandoffReviewPort`) — mechanism names, not legacy command-phase names.
- The concrete mechanisms stay in adapters: `src/adapters/mission/execute-mission-adapters.ts`,
  guarded by `each execute mechanism port is a distinct narrow adapter`.
- Characterization evidence is green before, and independent of, any deletion: the
  17 cases in `test/execute-mission-characterization.test.ts` pin ordering, fallback
  reporting, retry/relaunch recovery, cancellation, telemetry non-fatality, and
  fail-closed lifecycle behavior.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `LegacyActiveAdapter` is removed from production code | `grep -rn "LegacyActiveAdapter" src/` returns no match; execution is owned by `src/application/execute-mission-service.ts` per `ADR 0051` | PASS |
| Application code owns sequencing and partial-failure policy | `execute mission use case sequences workspace, agent, lifecycle, telemetry, then handoff` and `execute mission use case carries run state per call instead of holding it per slug` in `test/execute-mission-service.test.ts` | PASS |
| Ports describe external mechanisms rather than legacy command phases | `each execute mechanism port is a distinct narrow adapter` in `test/execute-mission-adapters.test.ts`; contracts in `src/application/ports/execute-mission.ts` | PASS |
| Agent launch, worktree manipulation, and telemetry remain in adapters | `workspace adapter maps a failed preflight and an unresolved worktree to falsy verdicts`, `agent execution adapter reports launcher errors and exit status as raw facts`, `telemetry adapter derives the stage window and duration from the launch detail` in `test/execute-mission-adapters.test.ts` | PASS |
| Lifecycle mutation uses checked transitions, failing closed | `execute workflow: lifecycle synchronization fails closed when the Mission authority refuses activation` in `test/execute-mission-characterization.test.ts` and `execute mission use case fails closed when the checked Mission authority refuses activation` in `test/execute-mission-service.test.ts`, per `ADR 0053` | PASS |
| Characterization proves equivalent `active` behavior | `execute workflow: success runs preflight, prepare, launch, record, telemetry, handoff in order`, `execute workflow: a task already active without a deferred rebase skips lifecycle synchronization`, `execute workflow: two concurrent slugs each resolve their own worktree and handoff` in `test/execute-mission-characterization.test.ts` | PASS |
| Characterization proves equivalent retry/failover behavior | `execute workflow: an agent fallback is reported, recorded, and handed off as the agent that actually ran` and `execute workflow: a handoff relaunch retry that recovers still completes the launch` in `test/execute-mission-characterization.test.ts` | PASS |
| Characterization proves equivalent handoff behavior | `execute workflow: handoff-and-review failure surfaces as an execution failure after durable evidence` in `test/execute-mission-characterization.test.ts`; `handoff review adapter forwards the resolved task file and returns the pipeline verdict` in `test/execute-mission-adapters.test.ts` | PASS |
| Failure and cancellation policy is preserved | `execute workflow: telemetry failure cannot fail a launch`, `execute workflow: a non-zero agent exit status stops before safety, telemetry, and handoff`, `execute workflow: cancellation after durable launch keeps both evidence records and skips handoff` in `test/execute-mission-characterization.test.ts` | PASS |
| Characterization suites green on this tree | `npx tsx --test test/execute-mission-characterization.test.ts test/execute-mission-service.test.ts test/execute-mission-adapters.test.ts` — 35 tests, 35 pass, 0 fail | PASS |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Proceed to CP-5 — verify TASK-2332.05's single canonical command-dispatch
path and prove both the CLI and the TUI surface reach it, using
`test/command-dispatch-convergence.test.ts`.
