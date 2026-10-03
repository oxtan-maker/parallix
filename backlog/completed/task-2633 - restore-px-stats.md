---
id: TASK-2633
title: restore px stats (remove telemetry, fix agent performance, auto-show after integrate)
status: done
assignee: [claude]
created_date: '2026-10-02 10:30'
labels: [ai_sdlc]
dependencies: []
---

## Problem

`px stats` is broken in three ways. This is one restoration task covering all
three, because they all live in the stats report surface and share one root
cause for the "unavailable" rows.

1. **Telemetry sections are noise.** The "Agent telemetry" table (# missions
   with telemetry, user value / AI SDLC / unknown) is not wanted. Telemetry is
   agent self-reporting; the team dropped interest in it. Remove the table.
2. **Agent performance not shown.** "Mission flow unavailable" and "Agent
   performance unavailable: lifecycle history was not read." Both rows appear
   every week. "Agent spend by stage" DOES render (it reads `usage_statistics`
   directly), which is the tell that the failure is in the lifecycle path, not
   the measurement DB.
3. **No auto-display after integration.** `px integrate` used to print the full
   weekly report; TASK-2479 moved it behind `px stats` / explicit flag / DEBUG
   and left only a one-line "Workflow stats recorded" confirmation. The team
   wants the report shown automatically after a mission is integrated again.

## Root cause — problem 2 (code vs db)

**DB is fine. Code is brittle.** The measurement DB
(`<PARALLIX_HOME>/parallix.db`) is healthy: 3147 `usage_statistics` rows,
3715 `board_lane_events`, 628 missions. The failure is a single bad mission
breaking hydration for the whole repository.

`readMissionFlowPopulation` (`src/adapters/cli/commands/stats.ts`) returns
`null` on ANY throw from `ConcreteMetricsReadAdapter.readOutcomes`. That calls
`SqliteMissionStore.loadByRepository`, which hydrates every mission in the repo.
Mission `task-2618` (a live in-progress mission: backlog→refined→active, never
`done`) has an incomplete checkpoint at position 3 with an **empty `criterion`
and empty `evidence`** (4 duplicate rows). `mission-serialization.ts:243`
(`requiredText`) throws `Persisted Mission goal criterion must not be empty`,
which aborts `Promise.all` for the whole repo.

Evidence (reproduce against the real DB with `node:sqlite`):
```
mission_checkpoint_goal_checks WHERE TRIM(criterion)=''
  -> mission_id=task-2618, checkpoint_position=3, criterion='', evidence=''  (x4)
```
Hydration error:
```
Error: Persisted Mission goal criterion must not be empty
  at requiredText mission-serialization.ts:243
  at checkpointsFrom mission-serialization.ts:275
  at SqliteMissionStore.loadByRepository mission-store.ts:116
```
Because `missionFlow` is `null`, `stats-report.ts:90,167,188,233` render
"lifecycle history was not read" for both the mission-flow and the
agent-performance tables. `renderWeeklyStatsReport` passes `missionFlow` to
both; `agent spend by stage` does not need it, which is why it still renders.

## Proposal

### 2a. Make the reader resilient (the real fix)
A single incomplete checkpoint must not blind all repo metrics. In
`SqliteMissionStore.loadByRepository` / `mission-serialization.ts`, do not
hard-throw on an empty goal `criterion`/`evidence`. Treat a checkpoint with an
empty criterion as an incomplete/partial checkpoint: hydrate the mission with
that checkpoint's goal checks omitted (or `goalCheck: []`) instead of aborting
the whole aggregate. Keep `requiredText` for genuinely malformed rows the
validation guards; the empty-goal-checkcase is a known partial-write state, not
corruption. This restores mission flow + agent performance for the whole repo
regardless of stray in-progress missions.

> This task only wraps the bad data so metrics recover. It does NOT fix why the
> bad data was written. That is a separate mission: `task-2634` — reject empty
> goal `criterion`/`evidence` at WRITE time (fail-closed) so no agent can
> persist an incomplete checkpoint in the first place.

### 2b. Repair the data (cleanup, optional, separate)
`task-2618` checkpoint 3 is an incomplete write. Either delete the 4 empty
`mission_checkpoint_goal_checks` rows, or complete the checkpoint. This is a
one-off; 2a makes it non-fatal going forward. Do NOT blanket-delete — verify the
mission is genuinely in-progress first.

### 1. Remove the telemetry table
Drop the "Agent telemetry" section from the weekly/range report rendering in
`src/adapters/cli/commands/stats-report.ts` (and any shared renderer). The
mission-flow table already counts completed missions via lifecycle; telemetry is
redundant and unwanted. Remove the helper functions that only feed it.

### 3. Auto-show the report after integration
In `recordPostIntegrationStats` (`src/adapters/cli/commands/integrate-post.ts`),
revert the TASK-2479 change: after a successful `recordIntegrationStats`, render
and print the weekly stats report (the same surface `px stats` uses), not just
the one-line confirmation. Keep the confirmation line. Guard behind the same
read path so a DB read failure does not fail the integration (integration must
not abort because stats rendering threw).

## Risks / notes

- 2a touches the operator Mission authority hydration. Ensure the board
  (`BoardMetrics`) and `px stats cohorts` — which share
  `ConcreteMetricsReadAdapter` and `loadByRepository` — also benefit, and that
  no test asserts the hard-throw on an empty goal check. If a test pins the
  throw, that assertion is the thing being removed; replace with a
  partial-checkpoint hydration assertion.
- Keep `readMissionFlowPopulation` returning `null` only when lane history truly
  cannot be read (no SQLite driver), not for a recoverable per-mission row.
- 3 must not fail integration on a stats read error: wrap the report render in
  the same try/catch that already protects `recordIntegrationStats`, or log a
  warning and continue.

## Verification

- `px stats` after fix: mission flow + agent performance populated for the
  current week; no "lifecycle history was not read"; no telemetry table.
- `px integrate` prints the weekly report at the end of a successful mission.
- `px stats cohorts` still works (shares the reader).
- Unit: partial-checkpoint mission hydrates with empty goal checks omitted;
  mission flow counts completed missions even when another repo mission has a
  bad checkpoint.
