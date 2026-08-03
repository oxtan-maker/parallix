# CP-2 — Declare the five mechanism ports

## Summary

Added `src/application/ports/execute-mission.ts` declaring the mechanism ports
the `ExecuteMission` use case will sequence, and re-exported them from
`src/application/ports.ts`. No consumer changed in this checkpoint: `ActivePort`,
`ActiveService`, and `LegacyActiveAdapter` are still wired exactly as before.

### Legacy phase → owning mechanism port

| Legacy `ActivePort` phase / adapter step | New owner |
|---|---|
| `validateSlug` → `preflight` | `MissionWorkspacePort.preflight` (`src/application/ports/execute-mission.ts:33`) |
| `validateSlug` → `resolveWorktree` | `MissionWorkspacePort.resolveWorktree` (`:35`) |
| `validateSlug` → `resolveTaskFile` | `MissionWorkspacePort.resolveTaskFile` (`:36`) |
| `validateSlug` → `buildCheckpointContext` + `readAgentConfig` + `buildExecutePrompt` | `AgentExecutionPort.prepare` (`:93`) returning `AgentLaunchPlan` (`:50`) |
| `launch` → `selectLaunchAndRecord` | `AgentExecutionPort.launch` (`:94`) returning `AgentLaunchOutcome` (`:75`) |
| `recordLaunch` → `enforceExecuteCommitSafety` | `MissionWorkspacePort.enforceCommitSafety` (`:43`) |
| `recordLaunch` → `getTaskStatus` | `MissionWorkspacePort.readTaskStatus` (`:38`) |
| `recordLaunch` → `synchronizeLifecycle` | `ExecuteMissionPorts.missionTransitions` (`:141`), the checked `MissionTransitionStore` driven through `MissionLifecycleService` |
| `recordLaunch` → `resolveAgentModel`/`resolveStageTelemetry`/`recordActiveStats` | `ExecuteTelemetryPort.recordLaunchTelemetry` (`:111`) |
| `handoff` → `runHandoffAndReview` | `HandoffReviewPort.runHandoffAndReview` (`:127`) |

Policy that deliberately did **not** move into a port: the operator messages
`Could not start execute agent (<agent>): …` and
`Execute agent (<agent>) exited with status N.` The port now returns raw facts
(`errorMessage`, `exitStatus`) so the use case owns that wording, matching the
CP-1 characterization at
`test/execute-mission-characterization.test.ts:203` and `:219`.

The per-slug `Map` at `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:36`
has no counterpart in these interfaces: `AgentLaunchPlan`, `TaskFileResolution`,
and `AgentLaunchOutcome` are the values the use case will carry between steps.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Replacement ports are named for workspace, agent execution, lifecycle/store, telemetry, and handoff/review mechanisms | `src/application/ports/execute-mission.ts:31`, `:91`, `:110`, `:126`, `:141` | PASS |
| Lifecycle mutation port is the checked `MissionTransitionStore` boundary | `src/application/ports/execute-mission.ts:141`, `src/application/domain-ports.ts:39`, ADR 0051 | PASS |
| Ports declare no filesystem, Git, subprocess, or SQLite type (ADR 0051 restricted area) | `src/application/ports/execute-mission.ts:1` — sole import is `MissionTransitionStore`; `agentConfig`/`detail` are `unknown` (`:57`, `:87`) | PASS |
| Port state replaces the adapter's per-slug `Map` with explicit values | `src/application/ports/execute-mission.ts:50` (`AgentLaunchPlan`), `:19` (`TaskFileResolution`), `:75` (`AgentLaunchOutcome`) vs `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:36` | PASS |
| Ports are reachable from the application ports barrel | `src/application/ports.ts:25` | PASS |
| No consumer changed yet; tree still typechecks and characterization holds | `npx tsc --noEmit` (clean), `npm test test/execute-mission-characterization.test.ts` — 17 pass / 0 fail | PASS |

Next action: CP-3 — implement `src/application/execute-mission-service.ts` owning
the preflight → prepare → launch → record → lifecycle → telemetry → handoff
ordering, the cancellation boundaries, and the best-effort telemetry policy
against these ports.
