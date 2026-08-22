# CP-2: Consumers routed through the shared projection

## Summary

Both operator surfaces now render from `src/application/projections/mission-activity.ts` and nothing else.

TUI (`src/interfaces/tui/agent-strip.tsx`):
- Removed the local `formatRunning` helper. Per-family text comes from `describeFamilyCoordinatorEvidence`, so the strip reads `N px cmd live` / `px cmd unknown` and never `N running`. The unattributed entry became `N px cmd live · family unknown`.
- Added an optional `missionActivity` prop rendering a leading authoritative `work:` entry via `summarizeMissionActivity` + `describeMissionActivityTotals` (`work: 2 live · 1 unconfirmed · 1 stale · 1 blocked · 3 idle`, non-zero states only, omitted when there is nothing to say).
- `src/interfaces/tui/shell.tsx` supplies it by mapping every board card through `projectMissionActivity`.

CLI (`px status`):
- `StatusMissionData` in `src/application/ports/cli-workflows.ts` gained `activity: MissionActivity | null` — the projection itself, not pre-rendered text, so the two surfaces cannot drift.
- Both `getMissionData` sites in `src/adapters/cli/commands/status-adapter.ts` populate it with `projectMissionActivity(card)`.
- `renderStatus` in `src/interfaces/cli/status.ts` prints `Mission work: …` and `Coordinator evidence: …` from `describeMissionWork` / `describeCoordinatorEvidence`.

Evidence plumbing fix (`src/application/projections/board-readers.ts` and `src/application/projections/mission-board.ts`): `liveSession` remains `undefined` when the process scan itself could not run, instead of collapsing to `null` at the card boundary. `null` keeps meaning "scan ran, nothing running". This makes the projection's `unknown` coordinator state reachable in production; `agentIsWorking` is unaffected because it already treats both as not-working.

`docs/agents.md` updated to the new strip sample, the `N px cmd live` / `px cmd unknown` vocabulary, and a new "Mission activity in `px status`" section.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Shared projection separates authoritative work from recovery evidence with lifecycle states | `src/application/projections/mission-activity.ts`; `liveSession: undefined` (unknown) vs `null` (stopped) in `src/application/projections/board-readers.ts` | Done |
| Agent strip does not call coordinator evidence an exact agent count | `"AgentStrip reports observed live px commands per family without calling them agents"` and `"AgentStrip says px command liveness is unknown when liveness was not observed"` in `test/agent-strip.test.ts` pass (`npx tsx --test test/agent-strip.test.ts`: 18/18) | Done |
| Selected-mission status exposes the same state | `StatusMissionData.activity` in `src/application/ports/cli-workflows.ts`; `renderStatus` in `src/interfaces/cli/status.ts` calls the same `describeMissionWork`/`describeCoordinatorEvidence` | Done |
| Overlap and unattributed families have deterministic, non-counting behavior | `projectMissionActivity` restates the single fact `resolveOperation` (`src/application/projections/current-work.ts`) already resolved by durable order; `"AgentStrip counts a session no family can claim instead of dropping it"` in `test/agent-strip.test.ts` | Done |
| Focused projection and both rendering paths cover required states | `test/mission-activity.test.ts` | Pending CP-3 |
| Static analysis passes | `npx tsc --noEmit` clean; `./scripts/verify-local.sh static-analysis` | Pending final gate |

Next action: add `test/mission-activity.test.ts` plus TUI and `px status` rendering tests for live, recovery-only, unknown, stale, blocked, and idle, then run `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` (CP-3).
