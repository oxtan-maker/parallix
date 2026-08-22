# CP-1: Activity read model traced and defined

## Summary

Traced both operator read paths and defined the shared projection.

Read paths traced:
- TUI: `BoardProjectionBuilder.build()` (`src/application/projections/board-readers.ts`) reconciles published current-work events through `reconcileCurrentWork` and separately scans the process table via `loadRunningSessions`. The scan result reaches `projectAgentAvailability` as per-family `runningSessions`, which `AgentStrip` rendered as `N running` — a coordinator-process count presented as an exact agent count.
- CLI: `createStatusBoardAdapter().getMissionData` (`src/adapters/cli/commands/status-adapter.ts`) reads the same `MissionCard` but dropped every activity field, so `px status` said nothing about work or liveness.

State matrix now encoded in `src/application/projections/mission-activity.ts`:
- Authoritative work (`MissionWorkActivity`): `working` with certainty `live` / `unknown` / `stale`, `blocked` with its recorded reason, or `idle`. Certainty maps `CurrentWorkFreshness.unverified` to the operator-facing word `unknown`.
- Recovery evidence (`CoordinatorEvidence`): `live` (with an optionally-null family), `stopped` (scan ran, nothing found), `unknown` (scan could not run).
- Overlapping operations: resolved upstream by `reconcileCurrentWork`'s durable-order `resolveOperation`; the projection restates the one standing fact and never merges or counts operations.
- Unattributed families: an attributed-family-less session stays `family: null` and is described without a family rather than guessed onto one.

Shared wording helpers (`describeMissionWork`, `describeCoordinatorEvidence`, `describeFamilyCoordinatorEvidence`, `describeMissionActivityTotals`) live in the same module so the TUI and `px status` cannot drift apart.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Shared projection separates authoritative work from recovery evidence with lifecycle states | `src/application/projections/mission-activity.ts` defines `MissionWorkActivity` (`working`/`blocked`/`idle` with `live`/`unknown`/`stale` certainty) and `CoordinatorEvidence` (`live`/`stopped`/`unknown`); `npx tsc --noEmit` passes | Done |
| Agent strip does not call coordinator evidence an exact agent count | `describeFamilyCoordinatorEvidence` in `src/application/projections/mission-activity.ts` emits `px cmd live` / `px cmd unknown` | Defined; consumer routing is CP-2 |
| Selected-mission status exposes the same state | `describeMissionWork` and `describeCoordinatorEvidence` are the single wording source for both surfaces | Defined; consumer routing is CP-2 |
| Overlap and unattributed families have deterministic, non-counting behavior | `resolveOperation` in `src/application/projections/current-work.ts` (durable order) is the single upstream resolver; `projectCoordinatorEvidence` preserves `family: null`; existing coverage in `test/task-2375-active-invocation-overlap.test.ts` | Done |
| Focused projection and both rendering paths cover required states | `test/mission-activity.test.ts` | Pending CP-3 |
| Static analysis passes | `./scripts/verify-local.sh static-analysis` | Pending final gate |

Next action: route `AgentStrip` and `createStatusBoardAdapter().getMissionData` through `projectMissionActivity` and the shared wording helpers (CP-2).
