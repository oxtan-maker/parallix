# CP-3 — Implement the `ExecuteMission` use case

## Summary

Added `src/application/execute-mission-service.ts`: an application-owned use case
that sequences the whole execute workflow through the CP-2 mechanism ports and
owns the policy that previously lived inside `LegacyActiveAdapter`.

Step ordering, each a call to an application-owned port:

| Step | Use case | Port |
|---|---|---|
| request guards + pre-launch cancellation | `execute-mission-service.ts:64-66` | — |
| preflight / worktree / task-file resolution | `execute-mission-service.ts:111-116` | `MissionWorkspacePort` (`ports/execute-mission.ts:31`) |
| agent preparation | `execute-mission-service.ts:72` | `AgentExecutionPort.prepare` (`ports/execute-mission.ts:93`) |
| agent launch | `execute-mission-service.ts:129` | `AgentExecutionPort.launch` (`ports/execute-mission.ts:94`) |
| durable launch record (commit safety) | `execute-mission-service.ts:155` | `MissionWorkspacePort.enforceCommitSafety` (`ports/execute-mission.ts:43`) |
| lifecycle synchronization | `execute-mission-service.ts:165`, `:190` | `ExecuteMissionPorts.missionTransitions` (`ports/execute-mission.ts:141`) |
| telemetry | `execute-mission-service.ts:170` | `ExecuteTelemetryPort` (`ports/execute-mission.ts:110`) |
| post-record cancellation + handoff/review | `execute-mission-service.ts:85-95` | `HandoffReviewPort` (`ports/execute-mission.ts:126`) |

Policy now owned by the application layer rather than an adapter:

- the operator messages `Could not start execute agent (<agent>): …` and
  `Execute agent (<agent>) exited with status N.` (`execute-mission-service.ts:135-139`)
- the deferred-rebase / not-yet-active condition that decides whether the lane
  needs synchronizing, carried over verbatim (`execute-mission-service.ts:164`)
- telemetry failure is swallowed (`execute-mission-service.ts:173-176`)
- fail-closed activation message (`execute-mission-service.ts:196`)

Run state: `LegacyActiveAdapter`'s per-slug `Map` has no counterpart. The
worktree and task resolution travel as a local `ExecuteWorkspace` value
(`execute-mission-service.ts:32`), the prompt/config as `AgentLaunchPlan`, and
the launch facts as `AgentLaunchOutcome` — all passed as arguments between
steps, so one service instance can run two slugs concurrently.

Consumers are still on `ActiveService`/`LegacyActiveAdapter`; the rewiring and
the adapters land in CP-4.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| An `ExecuteMission` use case under `src/application/` contains the full step ordering, each step a port call | `src/application/execute-mission-service.ts:63`, `:72`, `:77`, `:83`, `:90`, `:165`, `:170` | PASS |
| Partial-failure and cancellation policy is application-owned | `src/application/execute-mission-service.ts:66`, `:85`, `:135`, `:173`, `"execute mission use case cancels after the durable record without a rollback claim"`, `"execute mission use case keeps telemetry failures non-fatal"` | PASS |
| No per-slug workflow state in a module- or instance-level `Map` | `src/application/execute-mission-service.ts:32` (`ExecuteWorkspace` value), `"execute mission use case carries run state per call instead of holding it per slug"` | PASS |
| Every execute-path lifecycle change goes through the checked `MissionTransitionStore` / `MissionLifecycleService` boundary | `src/application/execute-mission-service.ts:190`, ADR 0051, `"execute mission use case fails closed when the checked Mission authority refuses activation"` | PASS |
| No filesystem, Git, subprocess, or SQLite import in the use case | `src/application/execute-mission-service.ts:1-12` — imports are contracts, lifecycle service, domain ids, and port types only | PASS |
| Operator messages preserved by the use case | `test/execute-mission-service.test.ts`, `"execute mission use case owns the launcher-error and exit-status operator messages"` | PASS |
| Port-level unit coverage replaces the `ActiveService` assertions with no net loss | `test/execute-mission-service.test.ts` — 8 pass / 0 fail via `npm test test/execute-mission-service.test.ts` | PASS |
| Tree typechecks with the new use case | `npx tsc --noEmit` (clean) | PASS |

Next action: CP-4 — implement `src/platform/runtime/lib/adapters/execute-mission-adapters.ts`
over the existing `active.ts` helpers, rewire
`src/platform/runtime/lib/composition/application-services.ts:185` and
`src/composition/production-capabilities.ts`, delete `LegacyActiveAdapter` plus
`ActivePort`, and retarget the `boundary-guards.ts:133` composition detection.
